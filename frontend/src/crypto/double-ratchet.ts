const HKDF_ZERO_SALT = new Uint8Array(32);
const MAX_SKIP = 100;

function buf2b64(buf: ArrayBuffer | Uint8Array): string {
  const u8 = buf instanceof ArrayBuffer ? new Uint8Array(buf) : buf;
  return btoa(String.fromCharCode(...u8));
}
function b642buf(b64: string): Uint8Array<ArrayBuffer> {
  const raw = atob(b64);
  const buf = new ArrayBuffer(raw.length);
  const view = new Uint8Array(buf);
  for (let i = 0; i < raw.length; i++) view[i] = raw.charCodeAt(i);
  return view;
}

// ---------------------------------------------------------------------------
// ECDH helpers
// ---------------------------------------------------------------------------

export async function generateDHKeyPair(): Promise<{ pub: string; priv: string }> {
  const kp = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveKey', 'deriveBits']
  );
  const pub = buf2b64(await crypto.subtle.exportKey('raw', kp.publicKey));
  const priv = buf2b64(await crypto.subtle.exportKey('pkcs8', kp.privateKey));
  return { pub, priv };
}

async function dh(myPrivB64: string, theirPubB64: string): Promise<ArrayBuffer> {
  const privateKey = await crypto.subtle.importKey(
    'pkcs8', b642buf(myPrivB64),
    { name: 'ECDH', namedCurve: 'P-256' },
    false, ['deriveBits']
  );
  const publicKey = await crypto.subtle.importKey(
    'raw', b642buf(theirPubB64),
    { name: 'ECDH', namedCurve: 'P-256' },
    false, []
  );
  return crypto.subtle.deriveBits({ name: 'ECDH', public: publicKey }, privateKey, 256);
}

// ---------------------------------------------------------------------------
// KDF chains
// ---------------------------------------------------------------------------

/**
 * KDF_RK: Root key ratchet step.
 * Takes the current root key bytes and fresh DH output,
 * returns (newRootKey, newChainKey) both as raw ArrayBuffer.
 */
async function kdfRK(
  rootKey: ArrayBuffer,
  dhOutput: ArrayBuffer
): Promise<{ rootKey: ArrayBuffer; chainKey: ArrayBuffer }> {
  const ikm = await crypto.subtle.importKey('raw', dhOutput, 'HKDF', false, ['deriveBits']);
  const derived = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(rootKey) as Uint8Array<ArrayBuffer>, info: new TextEncoder().encode('ratchet_rk') },
    ikm,
    512
  );
  return {
    rootKey: derived.slice(0, 32),
    chainKey: derived.slice(32, 64),
  };
}

/**
 * KDF_CK: Symmetric chain ratchet step.
 * Uses HMAC-SHA-256 keyed by the chain key with single-byte constants:
 *   HMAC(ck, 0x01) → message key
 *   HMAC(ck, 0x02) → next chain key
 * This matches the standard libsignal KDF_CK instantiation.
 */
async function kdfCK(
  chainKey: ArrayBuffer
): Promise<{ chainKey: ArrayBuffer; messageKey: ArrayBuffer }> {
  const hmacKey = await crypto.subtle.importKey(
    'raw', chainKey, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const messageKey = await crypto.subtle.sign('HMAC', hmacKey, new Uint8Array([0x01]));
  const nextChainKey = await crypto.subtle.sign('HMAC', hmacKey, new Uint8Array([0x02]));
  return { chainKey: nextChainKey, messageKey };
}

// ---------------------------------------------------------------------------
// AES-GCM encrypt / decrypt
// ---------------------------------------------------------------------------

async function aesEncrypt(
  messageKey: ArrayBuffer,
  plaintext: string,
  associatedData: Uint8Array<ArrayBuffer>
): Promise<{ iv: string; ct: string }> {
  const key = await crypto.subtle.importKey('raw', messageKey, 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: associatedData },
    key,
    new TextEncoder().encode(plaintext)
  );
  return { iv: buf2b64(iv), ct: buf2b64(ct) };
}

async function aesDecrypt(
  messageKey: ArrayBuffer,
  iv: string,
  ct: string,
  associatedData: Uint8Array<ArrayBuffer>
): Promise<string> {
  const key = await crypto.subtle.importKey('raw', messageKey, 'AES-GCM', false, ['decrypt']);
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: b642buf(iv), additionalData: associatedData },
    key,
    b642buf(ct)
  );
  return new TextDecoder().decode(pt);
}

// ---------------------------------------------------------------------------
// Session state
// ---------------------------------------------------------------------------

export interface RatchetSession {
  dhSend: { pub: string; priv: string };
  dhRecv: string | null;
  rootKey: ArrayBuffer;
  chainKeySend: ArrayBuffer | null;
  chainKeyRecv: ArrayBuffer | null;
  sendN: number;
  recvN: number;
  prevSendN: number;
  skippedKeys: Map<string, ArrayBuffer>;
}

function skippedKey(dhPub: string, n: number): string {
  return `${dhPub}|${n}`;
}

// ---------------------------------------------------------------------------
// Session initialization
// ---------------------------------------------------------------------------

/**
 * Create a session as the initiator (the party who receives the peer's
 * identity public key first and sends the first message).
 *
 * The shared secret from the identity ECDH becomes the initial root key,
 * and we immediately perform a DH ratchet step with our first ephemeral
 * keypair against the peer's identity key.
 */
export async function createInitiatorSession(
  sharedSecret: ArrayBuffer,
  peerIdentityPub: string
): Promise<RatchetSession> {
  const dhSend = await generateDHKeyPair();
  const dhOutput = await dh(dhSend.priv, peerIdentityPub);
  const { rootKey, chainKey } = await kdfRK(sharedSecret, dhOutput);

  return {
    dhSend,
    dhRecv: peerIdentityPub,
    rootKey,
    chainKeySend: chainKey,
    chainKeyRecv: null,
    sendN: 0,
    recvN: 0,
    prevSendN: 0,
    skippedKeys: new Map(),
  };
}

/**
 * Create a session as the responder (the party who will receive the first
 * message, which contains the initiator's first ephemeral DH public key).
 *
 * The responder uses their identity keypair as their initial "DH ratchet"
 * keypair. The first incoming message will trigger a DH ratchet step.
 */
export async function createResponderSession(
  sharedSecret: ArrayBuffer,
  myIdentityKeyPair: { pub: string; priv: string }
): Promise<RatchetSession> {
  return {
    dhSend: myIdentityKeyPair,
    dhRecv: null,
    rootKey: sharedSecret,
    chainKeySend: null,
    chainKeyRecv: null,
    sendN: 0,
    recvN: 0,
    prevSendN: 0,
    skippedKeys: new Map(),
  };
}

// ---------------------------------------------------------------------------
// Encrypt
// ---------------------------------------------------------------------------

export interface RatchetHeader {
  dh: string;
  pn: number;
  n: number;
}

/**
 * Encodes the header into a deterministic byte sequence for use as
 * AEAD associated data. The header is bound to the ciphertext so that
 * an attacker cannot swap headers between messages without detection.
 */
function encodeHeaderAD(header: RatchetHeader): Uint8Array<ArrayBuffer> {
  const dhBytes = b642buf(header.dh);
  const buf = new ArrayBuffer(dhBytes.length + 8);
  const view = new DataView(buf);
  new Uint8Array(buf).set(dhBytes, 0);
  view.setUint32(dhBytes.length, header.pn, false);
  view.setUint32(dhBytes.length + 4, header.n, false);
  return new Uint8Array(buf);
}

export async function ratchetEncrypt(
  session: RatchetSession,
  plaintext: string
): Promise<{ ciphertext: string; session: RatchetSession }> {
  if (!session.chainKeySend) {
    throw new Error('sending chain not initialized — waiting for first incoming message');
  }

  const { chainKey: newCK, messageKey } = await kdfCK(session.chainKeySend);

  const header: RatchetHeader = {
    dh: session.dhSend.pub,
    pn: session.prevSendN,
    n: session.sendN,
  };

  const ad = encodeHeaderAD(header);
  const { iv, ct } = await aesEncrypt(messageKey, plaintext, ad);

  const ciphertext = JSON.stringify({
    mode: 'double-ratchet',
    dh: header.dh,
    pn: header.pn,
    n: header.n,
    iv,
    ct,
  });

  return {
    ciphertext,
    session: {
      ...session,
      chainKeySend: newCK,
      sendN: session.sendN + 1,
    },
  };
}

// ---------------------------------------------------------------------------
// Decrypt
// ---------------------------------------------------------------------------

export interface DoubleRatchetPayload {
  mode: 'double-ratchet';
  dh: string;
  pn: number;
  n: number;
  iv: string;
  ct: string;
}

function parsePayload(raw: string): DoubleRatchetPayload {
  const p = JSON.parse(raw);
  if (p.mode !== 'double-ratchet') throw new Error(`unsupported mode: ${p.mode}`);
  if (typeof p.dh !== 'string') throw new Error('missing dh in header');
  if (typeof p.pn !== 'number') throw new Error('missing pn in header');
  if (typeof p.n !== 'number') throw new Error('missing n in header');
  if (typeof p.iv !== 'string' || typeof p.ct !== 'string') throw new Error('missing iv or ct');
  return p as DoubleRatchetPayload;
}

async function skipMessageKeys(
  session: RatchetSession,
  until: number
): Promise<RatchetSession> {
  if (!session.chainKeyRecv) return session;
  if (until - session.recvN > MAX_SKIP) {
    throw new Error('too many skipped messages');
  }

  let { chainKeyRecv, recvN, skippedKeys } = session;
  skippedKeys = new Map(skippedKeys);

  while (recvN < until) {
    const { chainKey: newCK, messageKey } = await kdfCK(chainKeyRecv!);
    skippedKeys.set(skippedKey(session.dhRecv!, recvN), messageKey);
    chainKeyRecv = newCK;
    recvN++;
  }

  return { ...session, chainKeyRecv, recvN, skippedKeys };
}

async function dhRatchetStep(
  session: RatchetSession,
  peerDHPub: string
): Promise<RatchetSession> {
  const newDH = await generateDHKeyPair();

  // Receiving chain: DH with our old send key and their new key
  const dhRecvOutput = await dh(session.dhSend.priv, peerDHPub);
  const { rootKey: rk1, chainKey: ckRecv } = await kdfRK(session.rootKey, dhRecvOutput);

  // Sending chain: DH with our new key and their new key
  const dhSendOutput = await dh(newDH.priv, peerDHPub);
  const { rootKey: rk2, chainKey: ckSend } = await kdfRK(rk1, dhSendOutput);

  return {
    ...session,
    dhSend: newDH,
    dhRecv: peerDHPub,
    rootKey: rk2,
    chainKeySend: ckSend,
    chainKeyRecv: ckRecv,
    prevSendN: session.sendN,
    sendN: 0,
    recvN: 0,
  };
}

export async function ratchetDecrypt(
  session: RatchetSession,
  raw: string
): Promise<{ plaintext: string; session: RatchetSession }> {
  const msg = parsePayload(raw);

  const msgHeader: RatchetHeader = { dh: msg.dh, pn: msg.pn, n: msg.n };
  const ad = encodeHeaderAD(msgHeader);

  // Check skipped keys first
  const skipKey = skippedKey(msg.dh, msg.n);
  const cached = session.skippedKeys.get(skipKey);
  if (cached) {
    const plaintext = await aesDecrypt(cached, msg.iv, msg.ct, ad);
    const newSkipped = new Map(session.skippedKeys);
    newSkipped.delete(skipKey);
    return { plaintext, session: { ...session, skippedKeys: newSkipped } };
  }

  let s = session;

  // If the DH key has changed, perform a DH ratchet step
  if (msg.dh !== s.dhRecv) {
    // Skip remaining messages in the current receiving chain
    s = await skipMessageKeys(s, msg.pn);
    // Perform the DH ratchet
    s = await dhRatchetStep(s, msg.dh);
  }

  // Skip ahead in the current receiving chain if needed
  s = await skipMessageKeys(s, msg.n);

  // Derive the message key for this message
  if (!s.chainKeyRecv) throw new Error('receiving chain not initialized');
  const { chainKey: newCK, messageKey } = await kdfCK(s.chainKeyRecv);

  const plaintext = await aesDecrypt(messageKey, msg.iv, msg.ct, ad);

  return {
    plaintext,
    session: {
      ...s,
      chainKeyRecv: newCK,
      recvN: s.recvN + 1,
    },
  };
}
