# Key Exchange

## Overview

Cipher-chat uses ECDH over P-256 to establish a shared session root between two users,
then derives a unique AES-GCM-256 key per message using HKDF. All cryptographic
operations happen in the browser via the Web Crypto API. The server never sees plaintext
or private keys.

## Key Generation

When a user registers or logs in, the browser generates a P-256 key pair:

- Private key: exported as PKCS#8, stored in localStorage under `ecdh-keys-<username>`
- Public key: exported as raw bytes, stored in localStorage and published to the server

Keys persist across sessions. If a key pair already exists for the username it is reused.

## Key Distribution

Public keys are published to the server on login via `POST /keys/publish`. When a user
joins a room, the server immediately sends them the stored public keys of all existing
room members over the WebSocket connection. When a new user joins, their public key is
broadcast to existing members via a `public_key` WebSocket message. This means key
exchange happens entirely over the existing WebSocket connection with no additional
REST round-trips.

## Session Root Derivation

Once a peer's public key is received, both sides independently derive the same session
root:

1. ECDH: `deriveBits` using own private key and peer's public key → 256-bit shared secret
2. HKDF: the shared secret is used as IKM with `salt = 32 zero bytes` and
   `info = "session_root_v1"` to derive an HMAC-SHA-256 key

The session root is derived once per session and never mutated. Both sides arrive at
the identical root because ECDH is commutative: `ECDH(A_priv, B_pub) = ECDH(B_priv, A_pub)`.

## Per-Message Key Derivation

Each message gets a unique AES-GCM-256 key derived from the session root and the
message index:

1. Export the session root as raw bytes
2. Import as HKDF key material
3. Derive with `salt = 32 zero bytes` and `info = "msg_key_v1_<idx>"`

The message index `idx` is included in the ciphertext payload so the receiver can
derive the exact same key. Keys at different indices are independent — a compromised
key at index N does not expose keys at other indices.

## Encryption

Each message is encrypted with AES-GCM-256:

- A 12-byte IV is generated fresh per message using `crypto.getRandomValues`
- The ciphertext payload is `{ mode: "ratchet", iv, ct, idx }` serialized as JSON

AES-GCM provides both confidentiality and integrity — a tampered ciphertext will fail
to decrypt.

## Session Establishment Flow

1. User A joins a room and sends their public key via WebSocket
2. Server broadcasts A's public key to existing room members
3. User B receives A's public key, derives the session root, sets `sessionReady = true`
4. User B sends their public key via WebSocket
5. User A receives B's public key, derives the same session root
6. Both sides can now encrypt and decrypt messages
7. Messages received before session is ready are queued and decrypted once the session
   is established

## Key Fingerprints

Each public key is fingerprinted by SHA-256 hashing the raw key bytes and encoding the
first 8 bytes as colon-separated uppercase hex (e.g. `A3:FF:12:4B:09:C2:87:1E`).
Fingerprints are displayed in the UI so users can verify their peer's identity
out-of-band, detecting a potential man-in-the-middle.

## Limitations

- **No forward secrecy across sessions.** The session root is derived once and used for
  the lifetime of the session. A Double Ratchet would derive a new root on each message
  exchange, limiting the blast radius of a key compromise.
- **Per-message key independence.** Within a session, each message uses a unique key
  derived from the session root and message index. A compromised message key does not
  expose other messages, but the session root remains the single point of trust.
- **Single device.** Keys are stored in localStorage and tied to one browser. There is
  no key sync or multi-device support.
- **No prekey bundle.** Unlike X3DH, there is no signed prekey or one-time prekey.
  Both users must be online and exchange public keys before messaging can begin.
- **Trust on first use.** Key fingerprint verification is manual and optional. There is
  no PKI or out-of-band verification enforced by the protocol.