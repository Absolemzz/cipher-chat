export const SAFETY_NUMBER_VERSION = 1;
const SAFETY_NUMBER_CONTEXT = 'cipher-chat:safety-number';
const SAFETY_NUMBER_GROUPS = 12;

export interface SafetyNumberInput {
  currentUserId: string;
  currentIdentityPublicKey: string;
  peerUserId: string;
  peerIdentityPublicKey: string;
}

export interface SafetyNumber {
  version: typeof SAFETY_NUMBER_VERSION;
  number: string;
  peerKeyFingerprint: string;
}

function bytes(value: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(new TextEncoder().encode(value));
}

function b642buf(b64: string): Uint8Array<ArrayBuffer> {
  const raw = atob(b64);
  const buf = new ArrayBuffer(raw.length);
  const view = new Uint8Array(buf);
  for (let i = 0; i < raw.length; i++) view[i] = raw.charCodeAt(i);
  return view;
}

function hex(bytesValue: Uint8Array): string {
  return Array.from(bytesValue)
    .map((byte) => byte.toString(16).padStart(2, '0').toUpperCase())
    .join('');
}

export async function getIdentityKeyFingerprint(publicKeyB64: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', b642buf(publicKeyB64));
  return hex(new Uint8Array(digest));
}

export async function deriveSafetyNumber(input: SafetyNumberInput): Promise<SafetyNumber> {
  const participants = [
    { userId: input.currentUserId, publicKey: input.currentIdentityPublicKey },
    { userId: input.peerUserId, publicKey: input.peerIdentityPublicKey },
  ].sort((a, b) => {
    const left = `${a.userId}\0${a.publicKey}`;
    const right = `${b.userId}\0${b.publicKey}`;
    return left.localeCompare(right);
  });

  const payload = JSON.stringify({
    context: SAFETY_NUMBER_CONTEXT,
    version: SAFETY_NUMBER_VERSION,
    participants,
  });
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-512', bytes(payload)));
  const groups: string[] = [];
  for (let i = 0; i < SAFETY_NUMBER_GROUPS; i++) {
    const value = (digest[i * 2] << 8) | digest[i * 2 + 1];
    groups.push(value.toString().padStart(5, '0'));
  }

  return {
    version: SAFETY_NUMBER_VERSION,
    number: groups.join(' '),
    peerKeyFingerprint: await getIdentityKeyFingerprint(input.peerIdentityPublicKey),
  };
}
