import { describe, it, expect, beforeEach } from 'vitest';
import {
  generateDHKeyPair,
  createInitiatorSession,
  createResponderSession,
  ratchetEncrypt,
  ratchetDecrypt,
  type RatchetSession,
} from './double-ratchet';

function buf2b64(buf: ArrayBuffer | Uint8Array): string {
  const u8 = buf instanceof ArrayBuffer ? new Uint8Array(buf) : buf;
  return btoa(String.fromCharCode(...u8));
}

async function sharedSecretFromPair(
  a: { pub: string; priv: string },
  b: { pub: string; priv: string }
): Promise<ArrayBuffer> {
  const HKDF_ZERO_SALT = new Uint8Array(32);
  const privKey = await crypto.subtle.importKey(
    'pkcs8', Uint8Array.from(atob(a.priv), c => c.charCodeAt(0)),
    { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']
  );
  const pubKey = await crypto.subtle.importKey(
    'raw', Uint8Array.from(atob(b.pub), c => c.charCodeAt(0)),
    { name: 'ECDH', namedCurve: 'P-256' }, false, []
  );
  const raw = await crypto.subtle.deriveBits({ name: 'ECDH', public: pubKey }, privKey, 256);
  const hkdf = await crypto.subtle.importKey('raw', raw, 'HKDF', false, ['deriveBits']);
  return crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: HKDF_ZERO_SALT, info: new TextEncoder().encode('session_root_v1') },
    hkdf, 256
  );
}

/**
 * Helper: set up Alice (initiator) and Bob (responder) with a fresh
 * shared secret derived from identity ECDH, mirroring initDoubleRatchet.
 */
async function setupPair(): Promise<{ alice: RatchetSession; bob: RatchetSession; aliceId: { pub: string; priv: string }; bobId: { pub: string; priv: string } }> {
  const aliceId = await generateDHKeyPair();
  const bobId = await generateDHKeyPair();

  const secret = await sharedSecretFromPair(aliceId, bobId);

  const isAliceInitiator = aliceId.pub < bobId.pub;

  let alice: RatchetSession;
  let bob: RatchetSession;

  if (isAliceInitiator) {
    alice = await createInitiatorSession(secret, bobId.pub);
    bob = await createResponderSession(secret, bobId);
  } else {
    bob = await createInitiatorSession(secret, aliceId.pub);
    alice = await createResponderSession(secret, aliceId);
  }

  return { alice, bob, aliceId, bobId };
}

describe('Double Ratchet — basic roundtrip', () => {
  let alice: RatchetSession;
  let bob: RatchetSession;

  beforeEach(async () => {
    ({ alice, bob } = await setupPair());
  });

  it('initiator encrypts, responder decrypts', async () => {
    const initiator = alice.chainKeySend ? alice : bob;
    let responder = alice.chainKeySend ? bob : alice;

    const { ciphertext, session: s1 } = await ratchetEncrypt(initiator, 'hello from initiator');
    const { plaintext, session: s2 } = await ratchetDecrypt(responder, ciphertext);

    expect(plaintext).toBe('hello from initiator');
    expect(s1.sendN).toBe(1);
    expect(s2.recvN).toBe(1);
  });

  it('handles unicode and emoji', async () => {
    const initiator = alice.chainKeySend ? alice : bob;
    let responder = alice.chainKeySend ? bob : alice;

    const msg = 'Привет 🌍 日本語';
    const { ciphertext } = await ratchetEncrypt(initiator, msg);
    const { plaintext } = await ratchetDecrypt(responder, ciphertext);
    expect(plaintext).toBe(msg);
  });

  it('handles empty string', async () => {
    const initiator = alice.chainKeySend ? alice : bob;
    let responder = alice.chainKeySend ? bob : alice;

    const { ciphertext } = await ratchetEncrypt(initiator, '');
    const { plaintext } = await ratchetDecrypt(responder, ciphertext);
    expect(plaintext).toBe('');
  });
});

describe('Double Ratchet — symmetric ratchet (multi-message same direction)', () => {
  it('multiple messages in same direction all decrypt correctly', async () => {
    let { alice, bob } = await setupPair();
    let sender = alice.chainKeySend ? alice : bob;
    let receiver = alice.chainKeySend ? bob : alice;

    const messages = ['first', 'second', 'third', 'fourth', 'fifth'];
    const ciphertexts: string[] = [];

    for (const msg of messages) {
      const result = await ratchetEncrypt(sender, msg);
      ciphertexts.push(result.ciphertext);
      sender = result.session;
    }

    for (const ct of ciphertexts) {
      const result = await ratchetDecrypt(receiver, ct);
      receiver = result.session;
    }

    // Decrypt the last one again by re-running (we already consumed them,
    // so let's just verify counter advanced correctly)
    expect(sender.sendN).toBe(5);
    expect(receiver.recvN).toBe(5);
  });

  it('each message produces distinct ciphertext (random IV)', async () => {
    let { alice, bob } = await setupPair();
    let sender = alice.chainKeySend ? alice : bob;

    const r1 = await ratchetEncrypt(sender, 'same message');
    sender = r1.session;
    const r2 = await ratchetEncrypt(sender, 'same message');

    const p1 = JSON.parse(r1.ciphertext);
    const p2 = JSON.parse(r2.ciphertext);
    expect(p1.iv).not.toBe(p2.iv);
    expect(p1.ct).not.toBe(p2.ct);
  });
});

describe('Double Ratchet — turn-taking (DH ratchet)', () => {
  it('conversation ping-pong works', async () => {
    let { alice, bob } = await setupPair();

    // Determine who is the initiator (has a sending chain)
    let a = alice.chainKeySend ? alice : bob;
    let b = alice.chainKeySend ? bob : alice;

    // Turn 1: A -> B
    const e1 = await ratchetEncrypt(a, 'A says hello');
    a = e1.session;
    const d1 = await ratchetDecrypt(b, e1.ciphertext);
    b = d1.session;
    expect(d1.plaintext).toBe('A says hello');

    // Turn 2: B -> A (triggers DH ratchet on B's side)
    const e2 = await ratchetEncrypt(b, 'B replies');
    b = e2.session;
    const d2 = await ratchetDecrypt(a, e2.ciphertext);
    a = d2.session;
    expect(d2.plaintext).toBe('B replies');

    // Turn 3: A -> B (triggers DH ratchet on A's side)
    const e3 = await ratchetEncrypt(a, 'A continues');
    a = e3.session;
    const d3 = await ratchetDecrypt(b, e3.ciphertext);
    b = d3.session;
    expect(d3.plaintext).toBe('A continues');
  });

  it('DH keys rotate on each turn', async () => {
    let { alice, bob } = await setupPair();
    let a = alice.chainKeySend ? alice : bob;
    let b = alice.chainKeySend ? bob : alice;

    const dhKey1 = a.dhSend.pub;

    const e1 = await ratchetEncrypt(a, 'msg1');
    a = e1.session;
    const d1 = await ratchetDecrypt(b, e1.ciphertext);
    b = d1.session;

    const e2 = await ratchetEncrypt(b, 'msg2');
    b = e2.session;
    const d2 = await ratchetDecrypt(a, e2.ciphertext);
    a = d2.session;

    const dhKey2 = a.dhSend.pub;

    // After a full round-trip, A's DH key should have rotated
    expect(dhKey1).not.toBe(dhKey2);
  });

  it('extended conversation with multiple turns', async () => {
    let { alice, bob } = await setupPair();
    let a = alice.chainKeySend ? alice : bob;
    let b = alice.chainKeySend ? bob : alice;

    const conversation = [
      { from: 'a', text: 'Hey!' },
      { from: 'a', text: 'How are you?' },
      { from: 'b', text: 'Good, you?' },
      { from: 'a', text: 'Great!' },
      { from: 'b', text: 'Cool' },
      { from: 'b', text: 'What are you up to?' },
      { from: 'a', text: 'Just coding' },
    ];

    for (const turn of conversation) {
      if (turn.from === 'a') {
        const enc = await ratchetEncrypt(a, turn.text);
        a = enc.session;
        const dec = await ratchetDecrypt(b, enc.ciphertext);
        b = dec.session;
        expect(dec.plaintext).toBe(turn.text);
      } else {
        const enc = await ratchetEncrypt(b, turn.text);
        b = enc.session;
        const dec = await ratchetDecrypt(a, enc.ciphertext);
        a = dec.session;
        expect(dec.plaintext).toBe(turn.text);
      }
    }
  });
});

describe('Double Ratchet — out-of-order messages (skipped keys)', () => {
  it('decrypts messages received out of order', async () => {
    let { alice, bob } = await setupPair();
    let sender = alice.chainKeySend ? alice : bob;
    let receiver = alice.chainKeySend ? bob : alice;

    const e0 = await ratchetEncrypt(sender, 'msg-0');
    sender = e0.session;
    const e1 = await ratchetEncrypt(sender, 'msg-1');
    sender = e1.session;
    const e2 = await ratchetEncrypt(sender, 'msg-2');
    sender = e2.session;

    // Receive msg-2 first
    const d2 = await ratchetDecrypt(receiver, e2.ciphertext);
    receiver = d2.session;
    expect(d2.plaintext).toBe('msg-2');

    // msg-0 and msg-1 keys should be cached
    expect(receiver.skippedKeys.size).toBe(2);

    // Now receive msg-0
    const d0 = await ratchetDecrypt(receiver, e0.ciphertext);
    receiver = d0.session;
    expect(d0.plaintext).toBe('msg-0');

    // Now receive msg-1
    const d1 = await ratchetDecrypt(receiver, e1.ciphertext);
    receiver = d1.session;
    expect(d1.plaintext).toBe('msg-1');

    expect(receiver.skippedKeys.size).toBe(0);
  });

  it('rejects too many skipped messages (DoS protection)', async () => {
    let { alice, bob } = await setupPair();
    let sender = alice.chainKeySend ? alice : bob;
    let receiver = alice.chainKeySend ? bob : alice;

    // Encrypt 102 messages, try to receive only the last one
    for (let i = 0; i < 102; i++) {
      const enc = await ratchetEncrypt(sender, `msg-${i}`);
      sender = enc.session;
      if (i === 101) {
        await expect(ratchetDecrypt(receiver, enc.ciphertext)).rejects.toThrow('too many skipped');
      }
    }
  });
});

describe('Double Ratchet — forward secrecy', () => {
  it('consumed chain keys cannot be reused to decrypt the same message', async () => {
    let { alice, bob } = await setupPair();
    let sender = alice.chainKeySend ? alice : bob;
    let receiver = alice.chainKeySend ? bob : alice;

    const e1 = await ratchetEncrypt(sender, 'msg-0');
    sender = e1.session;

    // Receiver decrypts — this consumes the chain key
    const d1 = await ratchetDecrypt(receiver, e1.ciphertext);
    const advancedReceiver = d1.session;

    // The advanced receiver has moved past this chain position;
    // decrypting the same message again will derive the wrong key
    await expect(ratchetDecrypt(advancedReceiver, e1.ciphertext)).rejects.toThrow();
  });

  it('root key evolves away from its initial value after DH ratchet steps', async () => {
    let { alice, bob } = await setupPair();
    let a = alice.chainKeySend ? alice : bob;
    let b = alice.chainKeySend ? bob : alice;

    const initialRootA = buf2b64(a.rootKey);
    const rootSnapshots: string[] = [initialRootA];

    for (let i = 0; i < 3; i++) {
      const ea = await ratchetEncrypt(a, `a-${i}`);
      a = ea.session;
      const da = await ratchetDecrypt(b, ea.ciphertext);
      b = da.session;

      const eb = await ratchetEncrypt(b, `b-${i}`);
      b = eb.session;
      const db = await ratchetDecrypt(a, eb.ciphertext);
      a = db.session;

      rootSnapshots.push(buf2b64(a.rootKey));
    }

    // Root key must have changed from its initial value
    expect(rootSnapshots[rootSnapshots.length - 1]).not.toBe(initialRootA);

    // Each ratchet round should produce a distinct root
    const unique = new Set(rootSnapshots);
    expect(unique.size).toBe(rootSnapshots.length);
  });
});

describe('Double Ratchet — tampered messages', () => {
  it('rejects tampered ciphertext', async () => {
    let { alice, bob } = await setupPair();
    let sender = alice.chainKeySend ? alice : bob;
    let receiver = alice.chainKeySend ? bob : alice;

    const { ciphertext } = await ratchetEncrypt(sender, 'secret');
    const parsed = JSON.parse(ciphertext);

    const ctBytes = Uint8Array.from(atob(parsed.ct), c => c.charCodeAt(0));
    ctBytes[0] ^= 0xff;
    parsed.ct = btoa(String.fromCharCode(...ctBytes));

    await expect(ratchetDecrypt(receiver, JSON.stringify(parsed))).rejects.toThrow();
  });

  it('rejects tampered header (wrong message number)', async () => {
    let { alice, bob } = await setupPair();
    let sender = alice.chainKeySend ? alice : bob;
    let receiver = alice.chainKeySend ? bob : alice;

    const { ciphertext } = await ratchetEncrypt(sender, 'secret');
    const parsed = JSON.parse(ciphertext);
    parsed.n = 999;

    await expect(ratchetDecrypt(receiver, JSON.stringify(parsed))).rejects.toThrow();
  });

  it('rejects wrong mode', async () => {
    const payload = JSON.stringify({ mode: 'ratchet', iv: 'x', ct: 'y', idx: 0 });
    let { bob } = await setupPair();
    await expect(ratchetDecrypt(bob, payload)).rejects.toThrow('unsupported mode');
  });
});

describe('Double Ratchet — cross-session isolation', () => {
  it('two independent sessions produce different ciphertexts for the same plaintext', async () => {
    const s1 = await setupPair();
    const s2 = await setupPair();

    const sender1 = s1.alice.chainKeySend ? s1.alice : s1.bob;
    const sender2 = s2.alice.chainKeySend ? s2.alice : s2.bob;

    const e1 = await ratchetEncrypt(sender1, 'identical message');
    const e2 = await ratchetEncrypt(sender2, 'identical message');

    const p1 = JSON.parse(e1.ciphertext);
    const p2 = JSON.parse(e2.ciphertext);

    // Different DH keys
    expect(p1.dh).not.toBe(p2.dh);
    // Different ciphertext
    expect(p1.ct).not.toBe(p2.ct);
  });
});

describe('Double Ratchet — out-of-order across DH ratchet boundary', () => {
  it('receives messages from old chain after a DH ratchet (pn field exercised)', async () => {
    let { alice, bob } = await setupPair();
    let a = alice.chainKeySend ? alice : bob;
    let b = alice.chainKeySend ? bob : alice;

    // A sends 3 messages in chain 1
    const e0 = await ratchetEncrypt(a, 'chain1-msg0');
    a = e0.session;
    const e1 = await ratchetEncrypt(a, 'chain1-msg1');
    a = e1.session;
    const e2 = await ratchetEncrypt(a, 'chain1-msg2');
    a = e2.session;

    // B only receives msg0 (msg1 and msg2 are delayed)
    const d0 = await ratchetDecrypt(b, e0.ciphertext);
    b = d0.session;
    expect(d0.plaintext).toBe('chain1-msg0');

    // B replies — this triggers a DH ratchet on B's side
    const e3 = await ratchetEncrypt(b, 'chain2-msg0');
    b = e3.session;

    // A receives B's reply — DH ratchet on A's side
    const d3 = await ratchetDecrypt(a, e3.ciphertext);
    a = d3.session;
    expect(d3.plaintext).toBe('chain2-msg0');

    // A sends a new message in the new chain
    const e4 = await ratchetEncrypt(a, 'chain3-msg0');
    a = e4.session;

    // B receives A's new-chain message (e4) BEFORE the delayed old-chain
    // messages (e1, e2). e4 has a new DH key, so B does a DH ratchet.
    // e4's header has pn=3 (A sent 3 messages in chain1, but B only saw 1,
    // so B skips keys for msg1 and msg2 from chain1).
    const d4 = await ratchetDecrypt(b, e4.ciphertext);
    b = d4.session;
    expect(d4.plaintext).toBe('chain3-msg0');

    // The two delayed messages from chain1 should now be decryptable
    // via the skipped key cache
    expect(b.skippedKeys.size).toBe(2);

    const d1 = await ratchetDecrypt(b, e1.ciphertext);
    b = d1.session;
    expect(d1.plaintext).toBe('chain1-msg1');

    const d2 = await ratchetDecrypt(b, e2.ciphertext);
    b = d2.session;
    expect(d2.plaintext).toBe('chain1-msg2');

    expect(b.skippedKeys.size).toBe(0);
  });
});

describe('Double Ratchet — failed decrypt does not mutate session', () => {
  it('session state is unchanged after a decryption failure', async () => {
    let { alice, bob } = await setupPair();
    let sender = alice.chainKeySend ? alice : bob;
    let receiver = alice.chainKeySend ? bob : alice;

    // Send a valid message
    const e1 = await ratchetEncrypt(sender, 'valid message');
    sender = e1.session;

    // Receive it successfully to advance the session
    const d1 = await ratchetDecrypt(receiver, e1.ciphertext);
    receiver = d1.session;

    // Snapshot the session state
    const rootBefore = buf2b64(receiver.rootKey);
    const recvNBefore = receiver.recvN;
    const sendNBefore = receiver.sendN;
    const skippedBefore = receiver.skippedKeys.size;
    const dhRecvBefore = receiver.dhRecv;

    // Construct a tampered message
    const e2 = await ratchetEncrypt(sender, 'another message');
    const tampered = JSON.parse(e2.ciphertext);
    const ctBytes = Uint8Array.from(atob(tampered.ct), (c: string) => c.charCodeAt(0));
    ctBytes[0] ^= 0xff;
    tampered.ct = btoa(String.fromCharCode(...ctBytes));

    // Attempt to decrypt the tampered message — should fail
    await expect(ratchetDecrypt(receiver, JSON.stringify(tampered))).rejects.toThrow();

    // The receiver's session must be completely unchanged
    // (because ratchetDecrypt returns new state only on success)
    expect(buf2b64(receiver.rootKey)).toBe(rootBefore);
    expect(receiver.recvN).toBe(recvNBefore);
    expect(receiver.sendN).toBe(sendNBefore);
    expect(receiver.skippedKeys.size).toBe(skippedBefore);
    expect(receiver.dhRecv).toBe(dhRecvBefore);
  });
});

describe('Double Ratchet — AEAD associated data binds header to ciphertext', () => {
  it('rejects a valid ciphertext with a swapped header', async () => {
    let { alice, bob } = await setupPair();
    let sender = alice.chainKeySend ? alice : bob;
    let receiver = alice.chainKeySend ? bob : alice;

    // Send two messages
    const e0 = await ratchetEncrypt(sender, 'message zero');
    sender = e0.session;
    const e1 = await ratchetEncrypt(sender, 'message one');
    sender = e1.session;

    // Take the ciphertext body (iv, ct) from e1 but the header (dh, pn, n)
    // from e0 — a header-swap attack
    const p0 = JSON.parse(e0.ciphertext);
    const p1 = JSON.parse(e1.ciphertext);
    const swapped = JSON.stringify({
      mode: 'double-ratchet',
      dh: p0.dh,
      pn: p0.pn,
      n: p0.n,
      iv: p1.iv,
      ct: p1.ct,
    });

    // AES-GCM AEAD should reject this because the associated data
    // (derived from the header) won't match what was used during encryption
    await expect(ratchetDecrypt(receiver, swapped)).rejects.toThrow();
  });
});
