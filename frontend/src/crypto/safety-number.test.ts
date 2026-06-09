import { describe, expect, it } from 'vitest';
import { deriveSafetyNumber } from './safety-number';

function buf2b64(buf: ArrayBuffer | Uint8Array): string {
  const u8 = buf instanceof ArrayBuffer ? new Uint8Array(buf) : buf;
  return btoa(String.fromCharCode(...u8));
}

async function generateIdentityPublicKey(): Promise<string> {
  const kp = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveKey',
    'deriveBits',
  ]);
  return buf2b64(await crypto.subtle.exportKey('raw', kp.publicKey));
}

describe('safety numbers', () => {
  it('derives a stable grouped numeric safety number for the same identity keys', async () => {
    const aliceKey = await generateIdentityPublicKey();
    const bobKey = await generateIdentityPublicKey();

    const first = await deriveSafetyNumber({
      currentUserId: 'alice',
      currentIdentityPublicKey: aliceKey,
      peerUserId: 'bob',
      peerIdentityPublicKey: bobKey,
    });
    const second = await deriveSafetyNumber({
      currentUserId: 'alice',
      currentIdentityPublicKey: aliceKey,
      peerUserId: 'bob',
      peerIdentityPublicKey: bobKey,
    });

    expect(first.number).toBe(second.number);
    expect(first.number).toMatch(/^(\d{5} ){11}\d{5}$/);
  });

  it('is symmetric for the same two participants', async () => {
    const aliceKey = await generateIdentityPublicKey();
    const bobKey = await generateIdentityPublicKey();

    const aliceView = await deriveSafetyNumber({
      currentUserId: 'alice',
      currentIdentityPublicKey: aliceKey,
      peerUserId: 'bob',
      peerIdentityPublicKey: bobKey,
    });
    const bobView = await deriveSafetyNumber({
      currentUserId: 'bob',
      currentIdentityPublicKey: bobKey,
      peerUserId: 'alice',
      peerIdentityPublicKey: aliceKey,
    });

    expect(aliceView.number).toBe(bobView.number);
  });

  it('changes when the peer identity key changes', async () => {
    const aliceKey = await generateIdentityPublicKey();
    const firstBobKey = await generateIdentityPublicKey();
    const secondBobKey = await generateIdentityPublicKey();

    const first = await deriveSafetyNumber({
      currentUserId: 'alice',
      currentIdentityPublicKey: aliceKey,
      peerUserId: 'bob',
      peerIdentityPublicKey: firstBobKey,
    });
    const second = await deriveSafetyNumber({
      currentUserId: 'alice',
      currentIdentityPublicKey: aliceKey,
      peerUserId: 'bob',
      peerIdentityPublicKey: secondBobKey,
    });

    expect(first.number).not.toBe(second.number);
    expect(first.peerKeyFingerprint).not.toBe(second.peerKeyFingerprint);
  });
});
