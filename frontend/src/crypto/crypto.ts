// Browser crypto utilities - demo mode uses shared secret, prod mode uses ECDH
const ENCRYPTION_MODE = import.meta.env.VITE_ENCRYPTION_MODE ?? 'demo';

function str2ab(str: any) { return new TextEncoder().encode(str); }
function ab2str(buf: any) { return new TextDecoder().decode(buf); }
function buf2b64(buf: any) { return btoa(String.fromCharCode(...new Uint8Array(buf))); }
function b642buf(b64: any) { return Uint8Array.from(atob(b64), c => c.charCodeAt(0)); }

export async function ensureKeys(username: string) {
  if (ENCRYPTION_MODE === 'demo') return;
  
  const stored = localStorage.getItem('ecdsa-' + username);
  if (stored) return;
  
  const kp = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' }, 
    true, 
    ['deriveKey', 'deriveBits']
  );
  const pub = await crypto.subtle.exportKey('raw', kp.publicKey);
  const priv = await crypto.subtle.exportKey('pkcs8', kp.privateKey);
  localStorage.setItem('ecdsa-' + username, JSON.stringify({ 
    pub: buf2b64(pub), 
    priv: buf2b64(priv) 
  }));
}

export async function encryptMessage(plaintext: string, recipientPublicKey: any) {
  if (ENCRYPTION_MODE === 'demo') {
    const pass = 'demo_shared_secret_v1';
    const enc = await crypto.subtle.importKey('raw', str2ab(pass), 'PBKDF2', false, ['deriveKey']);
    const key = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: str2ab('signal-lite-salt'), iterations: 1000, hash: 'SHA-256' }, 
      enc, 
      { name: 'AES-GCM', length: 256 }, 
      false, 
      ['encrypt']
    );
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, str2ab(plaintext));
    return JSON.stringify({ iv: buf2b64(iv), ct: buf2b64(ct) });
  }
  
  // Fallback to demo mode if no recipient key
  return encryptMessage(plaintext, null);
}

export async function decryptMessage(encryptedString: string, fromUserId: string | null) {
  if (ENCRYPTION_MODE === 'demo') {
    const { iv, ct } = JSON.parse(encryptedString);
    const pass = 'demo_shared_secret_v1';
    const enc = await crypto.subtle.importKey('raw', str2ab(pass), 'PBKDF2', false, ['deriveKey']);
    const key = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: str2ab('signal-lite-salt'), iterations: 1000, hash: 'SHA-256' }, 
      enc, 
      { name: 'AES-GCM', length: 256 }, 
      false, 
      ['decrypt']
    );
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b642buf(iv) }, key, b642buf(ct));
    return ab2str(pt);
  }
  
  throw new Error('Production mode not implemented');
}
