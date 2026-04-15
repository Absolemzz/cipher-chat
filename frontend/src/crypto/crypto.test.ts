import { describe, it, expect, beforeEach } from 'vitest';
import {
  deriveSessionRoot,
  deriveMessageKey,
  encryptMessage,
  decryptMessage,
  getKeyFingerprint,
} from './crypto';

function buf2b64(buf: ArrayBuffer | Uint8Array): string {
  const u8 = buf instanceof ArrayBuffer ? new Uint8Array(buf) : buf;
  return btoa(String.fromCharCode(...u8));
}

async function generateKeyPair() {
  const kp = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveKey', 'deriveBits']
  );
  const pub = buf2b64(await crypto.subtle.exportKey('raw', kp.publicKey));
  const priv = buf2b64(await crypto.subtle.exportKey('pkcs8', kp.privateKey));
  return { pub, priv };
}

describe('ECDH + HKDF session root derivation', () => {
  let alice: { pub: string; priv: string };
  let bob: { pub: string; priv: string };

  beforeEach(async () => {
    alice = await generateKeyPair();
    bob = await generateKeyPair();
  });

  it('both parties derive the same session root', async () => {
    const rootA = await deriveSessionRoot(alice.priv, bob.pub);
    const rootB = await deriveSessionRoot(bob.priv, alice.pub);

    const rawA = await crypto.subtle.exportKey('raw', rootA);
    const rawB = await crypto.subtle.exportKey('raw', rootB);

    expect(buf2b64(rawA)).toBe(buf2b64(rawB));
  });

  it('different key pairs produce different session roots', async () => {
    const eve = await generateKeyPair();

    const rootAB = await deriveSessionRoot(alice.priv, bob.pub);
    const rootAE = await deriveSessionRoot(alice.priv, eve.pub);

    const rawAB = await crypto.subtle.exportKey('raw', rootAB);
    const rawAE = await crypto.subtle.exportKey('raw', rootAE);

    expect(buf2b64(rawAB)).not.toBe(buf2b64(rawAE));
  });

  it('session root is deterministic for the same key pair', async () => {
    const root1 = await deriveSessionRoot(alice.priv, bob.pub);
    const root2 = await deriveSessionRoot(alice.priv, bob.pub);

    const raw1 = await crypto.subtle.exportKey('raw', root1);
    const raw2 = await crypto.subtle.exportKey('raw', root2);

    expect(buf2b64(raw1)).toBe(buf2b64(raw2));
  });
});

describe('per-message key derivation', () => {
  let sessionRoot: CryptoKey;

  beforeEach(async () => {
    const alice = await generateKeyPair();
    const bob = await generateKeyPair();
    sessionRoot = await deriveSessionRoot(alice.priv, bob.pub);
  });

  it('different indices produce different keys', async () => {
    const key0 = await deriveMessageKey(sessionRoot, 0);
    const key1 = await deriveMessageKey(sessionRoot, 1);

    const raw0 = await crypto.subtle.exportKey('raw', key0);
    const raw1 = await crypto.subtle.exportKey('raw', key1);

    expect(buf2b64(raw0)).not.toBe(buf2b64(raw1));
  });

  it('same index produces the same key', async () => {
    const key1 = await deriveMessageKey(sessionRoot, 42);
    const key2 = await deriveMessageKey(sessionRoot, 42);

    const raw1 = await crypto.subtle.exportKey('raw', key1);
    const raw2 = await crypto.subtle.exportKey('raw', key2);

    expect(buf2b64(raw1)).toBe(buf2b64(raw2));
  });

  it('rejects negative index', async () => {
    await expect(deriveMessageKey(sessionRoot, -1)).rejects.toThrow('non-negative integer');
  });

  it('rejects fractional index', async () => {
    await expect(deriveMessageKey(sessionRoot, 1.5)).rejects.toThrow('non-negative integer');
  });
});

describe('encrypt / decrypt roundtrip', () => {
  let aliceRoot: CryptoKey;
  let bobRoot: CryptoKey;

  beforeEach(async () => {
    const alice = await generateKeyPair();
    const bob = await generateKeyPair();
    aliceRoot = await deriveSessionRoot(alice.priv, bob.pub);
    bobRoot = await deriveSessionRoot(bob.priv, alice.pub);
  });

  it('encrypts and decrypts a message', async () => {
    const { ciphertext } = await encryptMessage('hello world', aliceRoot, 0);
    const { plaintext } = await decryptMessage(ciphertext, bobRoot);

    expect(plaintext).toBe('hello world');
  });

  it('handles unicode and emoji', async () => {
    const msg = 'Привет 🌍 日本語';
    const { ciphertext } = await encryptMessage(msg, aliceRoot, 0);
    const { plaintext } = await decryptMessage(ciphertext, bobRoot);

    expect(plaintext).toBe(msg);
  });

  it('handles empty string', async () => {
    const { ciphertext } = await encryptMessage('', aliceRoot, 0);
    const { plaintext } = await decryptMessage(ciphertext, bobRoot);

    expect(plaintext).toBe('');
  });

  it('multiple messages with sequential indices', async () => {
    const messages = ['first', 'second', 'third'];
    const ciphertexts: string[] = [];

    for (let i = 0; i < messages.length; i++) {
      const { ciphertext } = await encryptMessage(messages[i], aliceRoot, i);
      ciphertexts.push(ciphertext);
    }

    for (let i = 0; i < messages.length; i++) {
      const { plaintext } = await decryptMessage(ciphertexts[i], bobRoot);
      expect(plaintext).toBe(messages[i]);
    }
  });

  it('can decrypt out of order', async () => {
    const { ciphertext: ct0 } = await encryptMessage('msg-0', aliceRoot, 0);
    const { ciphertext: ct1 } = await encryptMessage('msg-1', aliceRoot, 1);
    const { ciphertext: ct2 } = await encryptMessage('msg-2', aliceRoot, 2);

    expect((await decryptMessage(ct2, bobRoot)).plaintext).toBe('msg-2');
    expect((await decryptMessage(ct0, bobRoot)).plaintext).toBe('msg-0');
    expect((await decryptMessage(ct1, bobRoot)).plaintext).toBe('msg-1');
  });
});

describe('ciphertext integrity', () => {
  let sessionRoot: CryptoKey;

  beforeEach(async () => {
    const alice = await generateKeyPair();
    const bob = await generateKeyPair();
    sessionRoot = await deriveSessionRoot(alice.priv, bob.pub);
  });

  it('rejects tampered ciphertext', async () => {
    const { ciphertext } = await encryptMessage('secret', sessionRoot, 0);
    const parsed = JSON.parse(ciphertext);
    const ctBytes = Uint8Array.from(atob(parsed.ct), c => c.charCodeAt(0));
    ctBytes[0] ^= 0xff;
    parsed.ct = btoa(String.fromCharCode(...ctBytes));

    await expect(decryptMessage(JSON.stringify(parsed), sessionRoot)).rejects.toThrow();
  });

  it('rejects wrong session root', async () => {
    const eve = await generateKeyPair();
    const wrongRoot = await deriveSessionRoot(eve.priv, (await generateKeyPair()).pub);

    const { ciphertext } = await encryptMessage('secret', sessionRoot, 0);

    await expect(decryptMessage(ciphertext, wrongRoot)).rejects.toThrow();
  });

  it('same plaintext at same index produces different ciphertexts (random IV)', async () => {
    const { ciphertext: ct1 } = await encryptMessage('hello', sessionRoot, 0);
    const { ciphertext: ct2 } = await encryptMessage('hello', sessionRoot, 0);

    const parsed1 = JSON.parse(ct1);
    const parsed2 = JSON.parse(ct2);
    expect(parsed1.iv).not.toBe(parsed2.iv);
  });
});

describe('key fingerprints', () => {
  it('returns colon-separated uppercase hex', async () => {
    const { pub } = await generateKeyPair();
    const fp = await getKeyFingerprint(pub);

    expect(fp).toMatch(/^([0-9A-F]{2}:){7}[0-9A-F]{2}$/);
  });

  it('same key produces same fingerprint', async () => {
    const { pub } = await generateKeyPair();
    const fp1 = await getKeyFingerprint(pub);
    const fp2 = await getKeyFingerprint(pub);

    expect(fp1).toBe(fp2);
  });

  it('different keys produce different fingerprints', async () => {
    const kp1 = await generateKeyPair();
    const kp2 = await generateKeyPair();
    const fp1 = await getKeyFingerprint(kp1.pub);
    const fp2 = await getKeyFingerprint(kp2.pub);

    expect(fp1).not.toBe(fp2);
  });
});
