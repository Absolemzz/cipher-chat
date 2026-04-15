import { createInitiatorSession, createResponderSession, type RatchetSession } from './double-ratchet';

function str2ab(str: string) { return new TextEncoder().encode(str); }
function ab2str(buf: ArrayBuffer): string { return new TextDecoder().decode(buf); }
function buf2b64(buf: ArrayBuffer | Uint8Array) {
  const u8 = buf instanceof ArrayBuffer ? new Uint8Array(buf) : buf;
  return btoa(String.fromCharCode(...u8));
}
function b642buf(b64: string) { return Uint8Array.from(atob(b64), c => c.charCodeAt(0)); }

const HKDF_ZERO_SALT = new Uint8Array(32);
const SESSION_ROOT_INFO = new TextEncoder().encode('session_root_v1');

export async function ensureKeys(username: string): Promise<string | null> {
  const stored = localStorage.getItem(`ecdh-keys-${username}`);
  if (stored) {
    const { pub } = JSON.parse(stored);
    return pub;
  }
  const kp = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveKey', 'deriveBits']
  );
  const pub = await crypto.subtle.exportKey('raw', kp.publicKey);
  const priv = await crypto.subtle.exportKey('pkcs8', kp.privateKey);
  const pubB64 = buf2b64(pub);
  const privB64 = buf2b64(priv);
  localStorage.setItem(`ecdh-keys-${username}`, JSON.stringify({ pub: pubB64, priv: privB64 }));
  return pubB64;
}

export function getPublicKey(username: string): string | null {
  const stored = localStorage.getItem(`ecdh-keys-${username}`);
  if (!stored) return null;
  return JSON.parse(stored).pub;
}

export async function getKeyFingerprint(publicKeyB64: string): Promise<string> {
  const buf = b642buf(publicKeyB64);
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash))
    .slice(0, 8)
    .map(b => b.toString(16).padStart(2, '0').toUpperCase())
    .join(':');
}

export async function deriveSessionRoot(
  myPrivKeyB64: string,
  theirPubKeyB64: string
): Promise<CryptoKey> {
  const privateKey = await crypto.subtle.importKey(
    'pkcs8', b642buf(myPrivKeyB64),
    { name: 'ECDH', namedCurve: 'P-256' },
    false, ['deriveBits']
  );
  const publicKey = await crypto.subtle.importKey(
    'raw', b642buf(theirPubKeyB64),
    { name: 'ECDH', namedCurve: 'P-256' },
    false, []
  );
  const sharedBits = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: publicKey },
    privateKey,
    256
  );
  const hkdfKey = await crypto.subtle.importKey(
    'raw', sharedBits, 'HKDF', false, ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: HKDF_ZERO_SALT, info: SESSION_ROOT_INFO },
    hkdfKey,
    { name: 'HMAC', hash: 'SHA-256', length: 256 },
    true,
    ['sign']
  );
}

export async function initializeSessionRootFromPeer(
  username: string,
  peerPublicKeyB64: string
): Promise<CryptoKey> {
  const stored = localStorage.getItem(`ecdh-keys-${username}`);
  if (!stored) throw new Error('No local keypair found');
  const { priv } = JSON.parse(stored);
  return deriveSessionRoot(priv, peerPublicKeyB64);
}

export async function deriveMessageKey(sessionRoot: CryptoKey, idx: number): Promise<CryptoKey> {
  if (!Number.isInteger(idx) || idx < 0) {
    throw new Error('idx must be a non-negative integer');
  }
  const ikm = await crypto.subtle.exportKey('raw', sessionRoot);
  const hkdfBase = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveKey']);
  const info = new TextEncoder().encode(`msg_key_v1_${idx}`);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: HKDF_ZERO_SALT, info },
    hkdfBase,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );
}

export async function encryptMessage(
  plaintext: string,
  sessionRoot: CryptoKey,
  idx: number
): Promise<{ ciphertext: string }> {
  if (!Number.isInteger(idx) || idx < 0) {
    throw new Error('idx must be a non-negative integer');
  }
  const messageKey = await deriveMessageKey(sessionRoot, idx);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, messageKey, str2ab(plaintext));
  return {
    ciphertext: JSON.stringify({ mode: 'ratchet', iv: buf2b64(iv), ct: buf2b64(ct), idx })
  };
}

export async function decryptMessage(
  encryptedString: string,
  sessionRoot: CryptoKey
): Promise<{ plaintext: string }> {
  const parsed = JSON.parse(encryptedString) as { mode?: unknown; iv?: unknown; ct?: unknown; idx?: unknown };

  if (parsed.mode !== 'ratchet') throw new Error('only mode "ratchet" is supported');
  if (typeof parsed.idx !== 'number' || !Number.isInteger(parsed.idx)) throw new Error('missing or invalid idx');
  if (typeof parsed.iv !== 'string' || typeof parsed.ct !== 'string') throw new Error('missing iv or ct');

  const messageKey = await deriveMessageKey(sessionRoot, parsed.idx);
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: b642buf(parsed.iv) },
    messageKey,
    b642buf(parsed.ct)
  );
  return { plaintext: ab2str(pt) };
}

// ---------------------------------------------------------------------------
// Double Ratchet session initialization
// ---------------------------------------------------------------------------

/**
 * Derives the initial shared secret from identity keys and creates a
 * Double Ratchet session. The `isInitiator` flag determines which role
 * this party plays: the initiator sends the first message and performs
 * the first DH ratchet step immediately; the responder waits for the
 * first incoming message to trigger the ratchet.
 *
 * Deterministic initiator selection: the party whose identity public key
 * is lexicographically smaller is the initiator. This ensures both sides
 * agree without an extra round-trip.
 */
export async function initDoubleRatchet(
  username: string,
  peerPubKeyB64: string
): Promise<RatchetSession> {
  const stored = localStorage.getItem(`ecdh-keys-${username}`);
  if (!stored) throw new Error('No local keypair found');
  const { pub, priv } = JSON.parse(stored) as { pub: string; priv: string };

  const privateKey = await crypto.subtle.importKey(
    'pkcs8', b642buf(priv),
    { name: 'ECDH', namedCurve: 'P-256' },
    false, ['deriveBits']
  );
  const publicKey = await crypto.subtle.importKey(
    'raw', b642buf(peerPubKeyB64),
    { name: 'ECDH', namedCurve: 'P-256' },
    false, []
  );
  const sharedBits = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: publicKey },
    privateKey,
    256
  );

  const hkdfKey = await crypto.subtle.importKey('raw', sharedBits, 'HKDF', false, ['deriveBits']);
  const sharedSecret = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: HKDF_ZERO_SALT, info: SESSION_ROOT_INFO },
    hkdfKey,
    256
  );

  const isInitiator = pub < peerPubKeyB64;

  if (isInitiator) {
    return createInitiatorSession(sharedSecret, peerPubKeyB64);
  }
  return createResponderSession(sharedSecret, { pub, priv });
}