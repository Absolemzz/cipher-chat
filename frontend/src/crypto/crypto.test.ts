import { describe, it, expect } from 'vitest';
import { getKeyFingerprint } from './crypto';

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
