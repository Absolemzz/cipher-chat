import { createBidirectionalSession, type RatchetSession } from './double-ratchet';

function str2ab(str: string) {
  return new TextEncoder().encode(str);
}
function buf2b64(buf: ArrayBuffer | Uint8Array) {
  const u8 = buf instanceof ArrayBuffer ? new Uint8Array(buf) : buf;
  return btoa(String.fromCharCode(...u8));
}
function b642buf(b64: string) {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

const HKDF_ZERO_SALT = new Uint8Array(32);
const SESSION_ROOT_INFO = new TextEncoder().encode('session_root_v1');
const AUTH_SIGNING_PREFIX = 'auth-signing-keys';

export async function ensureKeys(username: string): Promise<string | null> {
  const stored = localStorage.getItem(`ecdh-keys-${username}`);
  if (stored) {
    const { pub } = JSON.parse(stored);
    return pub;
  }
  const kp = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveKey',
    'deriveBits',
  ]);
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

export async function ensureAuthSigningKey(username: string): Promise<string> {
  const stored = localStorage.getItem(`${AUTH_SIGNING_PREFIX}-${username}`);
  if (stored) {
    const { pub } = JSON.parse(stored) as { pub: string };
    return pub;
  }

  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ]);
  const pub = await crypto.subtle.exportKey('spki', kp.publicKey);
  const priv = await crypto.subtle.exportKey('pkcs8', kp.privateKey);
  const pubB64 = buf2b64(pub);
  const privB64 = buf2b64(priv);
  localStorage.setItem(
    `${AUTH_SIGNING_PREFIX}-${username}`,
    JSON.stringify({ pub: pubB64, priv: privB64 }),
  );
  return pubB64;
}

export async function signAuthChallenge(username: string, challenge: string): Promise<string> {
  const stored = localStorage.getItem(`${AUTH_SIGNING_PREFIX}-${username}`);
  if (!stored) throw new Error('No local auth signing key found for this username');
  const { priv } = JSON.parse(stored) as { priv: string };
  const privateKey = await crypto.subtle.importKey(
    'pkcs8',
    b642buf(priv),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    privateKey,
    str2ab(challenge),
  );
  return buf2b64(signature);
}

export async function getKeyFingerprint(publicKeyB64: string): Promise<string> {
  const buf = b642buf(publicKeyB64);
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash))
    .slice(0, 8)
    .map((b) => b.toString(16).padStart(2, '0').toUpperCase())
    .join(':');
}

// ---------------------------------------------------------------------------
// Double Ratchet session initialization
// ---------------------------------------------------------------------------

/**
 * Derives the initial shared secret from identity keys and creates a
 * Double Ratchet session. Initial sending and receiving chains are derived
 * separately so either participant can send the first message.
 */
export async function initDoubleRatchet(
  username: string,
  peerPubKeyB64: string,
): Promise<RatchetSession> {
  const stored = localStorage.getItem(`ecdh-keys-${username}`);
  if (!stored) throw new Error('No local keypair found');
  const { pub, priv } = JSON.parse(stored) as { pub: string; priv: string };

  const privateKey = await crypto.subtle.importKey(
    'pkcs8',
    b642buf(priv),
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    ['deriveBits'],
  );
  const publicKey = await crypto.subtle.importKey(
    'raw',
    b642buf(peerPubKeyB64),
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );
  const sharedBits = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: publicKey },
    privateKey,
    256,
  );

  const hkdfKey = await crypto.subtle.importKey('raw', sharedBits, 'HKDF', false, ['deriveBits']);
  const sharedSecret = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: HKDF_ZERO_SALT, info: SESSION_ROOT_INFO },
    hkdfKey,
    256,
  );

  return createBidirectionalSession(sharedSecret, { pub, priv }, peerPubKeyB64);
}
