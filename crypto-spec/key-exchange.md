# Key Exchange & Double Ratchet Protocol

## Overview

Cipher Chat uses ECDH over P-256 for initial key agreement, then a Double Ratchet
protocol for ongoing message encryption. The Double Ratchet combines a Diffie-Hellman
ratchet (rotating ephemeral key pairs per conversation turn) with a symmetric ratchet
(deriving unique keys per message within a turn). All cryptographic operations happen
in the browser via the Web Crypto API. The server never sees plaintext or private keys.

## Key Generation

When a user registers or logs in, the browser generates a P-256 key pair:

- Private key: exported as PKCS#8, stored in localStorage under `ecdh-keys-<username>`
- Public key: exported as raw bytes, stored in localStorage and published to the server

Keys persist across sessions. If a key pair already exists for the username it is reused.
These identity keys are used for the initial ECDH handshake; the Double Ratchet generates
fresh ephemeral keys from that point forward.

## Key Distribution

Public keys are published to the server on login via `POST /keys/publish`. When a user
joins a room, the server immediately sends them the stored public keys of all existing
room members over the WebSocket connection. When a new user joins, their public key is
broadcast to existing members via a `public_key` WebSocket message. Key exchange happens
entirely over the existing WebSocket connection with no additional REST round-trips.

## Key Transparency Log

Every call to `POST /keys/publish` appends a record to the server-side `key_log` table
(append-only — entries are never deleted or updated). Each record stores:

| Column         | Type    | Purpose                                |
|----------------|---------|----------------------------------------|
| `id`           | INTEGER | Auto-incrementing sequence number      |
| `user_id`      | TEXT    | Owner of the key                       |
| `public_key`   | TEXT    | The published key (base64)             |
| `published_at` | INTEGER | Epoch ms timestamp of the publish      |

Clients can query a peer's full key history via `GET /keys/:userId/log` (authenticated).
When a peer's public key is received over WebSocket, the client:

1. Fetches the peer's key log from the server
2. Compares the received key against the last-known key stored in `localStorage`
3. If the key has changed and more than one key is on record, displays a warning banner
   advising the user to verify their peer's fingerprint out-of-band
4. Persists the current key in `localStorage` for future cross-session comparisons

This provides a lightweight transparency mechanism: an honest-but-curious server cannot
silently substitute a public key without leaving a trail in the log. A fully malicious
server could of course forge the log, but the client-side key pinning in `localStorage`
still detects the substitution locally.

## Session Initialization

Once a peer's public key is received, both sides derive a shared secret:

1. **ECDH**: `deriveBits(myPriv, peerPub)` → 256-bit shared secret
2. **HKDF**: shared secret as IKM, `salt = 32 zero bytes`, `info = "session_root_v1"` → 256-bit initial root key

### Role determination

Both parties must agree on who is the **initiator** (sends first) and who is the
**responder** (receives first). This is determined deterministically: the party whose
base64-encoded identity public key is lexicographically smaller is the initiator.
No extra round-trip is needed.

### Initiator setup

The initiator immediately generates a fresh ephemeral ECDH key pair and performs a
DH ratchet step against the responder's identity public key:

1. `dhOutput = ECDH(ephemeralPriv, peerIdentityPub)`
2. `(rootKey, sendChainKey) = KDF_RK(initialRootKey, dhOutput)`

The initiator can now encrypt messages using the sending chain.

### Responder setup

The responder stores the initial root key and uses their identity key pair as their
initial DH ratchet key. They cannot encrypt until they receive the first message
(which contains the initiator's ephemeral public key and triggers the DH ratchet).

## The Double Ratchet

### DH Ratchet (per turn)

Each time the conversation "turns" (Alice was sending, now Bob sends), the new sender:

1. Generates a fresh ephemeral ECDH key pair
2. Performs two DH exchanges against the peer's last public key:
   - **Receiving chain**: `ECDH(oldPriv, peerNewPub)` → `KDF_RK(rootKey, dhOutput)` → new root key + receiving chain key
   - **Sending chain**: `ECDH(newPriv, peerNewPub)` → `KDF_RK(rootKey, dhOutput)` → new root key + sending chain key
3. Resets message counters for the new sending chain

The old private key is discarded. An attacker who compromises the device after a ratchet
step cannot recover messages encrypted under previous DH key pairs.

### Symmetric Ratchet (per message)

Within a single turn (e.g., Alice sends 5 messages before Bob replies), each message
advances the chain key:

1. `(newChainKey, messageKey) = KDF_CK(chainKey)`
2. The message is encrypted with `messageKey` using AES-GCM-256
3. The old chain key is replaced by `newChainKey`

Each `KDF_CK` step produces a unique, independent message key. Old chain keys are
overwritten and cannot be recovered.

### KDF details

**KDF_RK** (Root Key ratchet):
- `HKDF-SHA-256(ikm=dhOutput, salt=rootKey, info="ratchet_rk")` → 512 bits
- First 256 bits = new root key, last 256 bits = new chain key

**KDF_CK** (Chain Key ratchet):
- Message key: `HMAC-SHA-256(key=chainKey, data=0x01)` → 256-bit message key
- Next chain key: `HMAC-SHA-256(key=chainKey, data=0x02)` → 256-bit new chain key

This matches the standard libsignal KDF_CK instantiation: single-byte constants
ensure the two outputs are cryptographically independent from the same chain key.

## Wire Format

Each encrypted message is a JSON string:

```json
{
  "mode": "double-ratchet",
  "dh": "<sender's current DH ratchet public key, base64>",
  "pn": 3,
  "n": 0,
  "iv": "<12-byte AES-GCM IV, base64>",
  "ct": "<AES-GCM ciphertext, base64>"
}
```

| Field  | Purpose |
|--------|---------|
| `mode` | Protocol version identifier (`"double-ratchet"`) |
| `dh`   | Sender's current ephemeral public key. If it differs from the receiver's last-seen key, the receiver performs a DH ratchet step. |
| `pn`   | Number of messages sent in the sender's *previous* sending chain. Allows the receiver to skip ahead and cache skipped message keys. |
| `n`    | Message number within the current sending chain. |
| `iv`   | 12-byte random IV for AES-GCM. |
| `ct`   | AES-GCM-256 ciphertext. |

Legacy messages with `mode: "ratchet"` (from the pre-Double-Ratchet protocol) are
detected and displayed as `[legacy encrypted message]` rather than attempting decryption.

## Skipped Message Handling

If messages arrive out of order (e.g., the receiver gets message `n=2` before `n=0`),
the receiver:

1. Advances the chain key from its current position to `n`, caching each intermediate
   message key in a `skippedKeys` map keyed by `(dhPub, n)`
2. Decrypts the received message
3. When the skipped messages arrive later, their cached keys are used and then deleted

The skipped key cache is bounded at 100 entries. A message that would require skipping
more than 100 positions is rejected to prevent resource exhaustion attacks.

## Encryption

Each message is encrypted with AES-GCM-256:

- A 12-byte IV is generated fresh per message using `crypto.getRandomValues`
- The message header (`dh || pn || n`) is serialized into a deterministic byte sequence
  and passed as AES-GCM `additionalData`. This binds the header to the ciphertext: an
  attacker cannot swap a valid ciphertext between messages with different headers without
  being detected by AES-GCM's authentication tag
- AES-GCM provides both confidentiality and integrity — tampered ciphertext or tampered
  headers fail decryption

## Session Establishment Flow

1. User A joins a room and sends their identity public key via WebSocket
2. Server broadcasts A's public key to existing room members
3. User B receives A's public key, initializes a Double Ratchet session
4. User B sends their identity public key via WebSocket
5. User A receives B's public key, initializes their side of the session
6. The initiator (determined by key ordering) can send immediately; the responder's
   sending chain activates upon receiving the first message
7. Messages received before the session is ready are queued and decrypted once established

## Key Fingerprints

Each identity public key is fingerprinted by SHA-256 hashing the raw key bytes and
encoding the first 8 bytes as colon-separated uppercase hex
(e.g., `A3:FF:12:4B:09:C2:87:1E`). Fingerprints are displayed in the UI so users can
verify their peer's identity out-of-band, detecting a potential man-in-the-middle attack.

## Security Properties

- **Forward secrecy (per turn)**: After a DH ratchet step, old private keys are discarded.
  Compromising the device after the ratchet cannot recover messages from previous turns.
- **Per-message key independence**: Within a turn, each message uses a unique key derived
  from the chain ratchet. A compromised message key does not expose other messages.
- **Break-in recovery**: If an attacker gains temporary access to session state, the next
  DH ratchet step (triggered by the peer's reply) re-establishes security using fresh
  key material the attacker does not possess.

## Limitations

- **No X3DH (prekey bundles)**. Both users must be online to establish a session. There
  is no signed prekey or one-time prekey for offline session initiation.
- **2-party only**. The ratchet operates between exactly two peers in a room.
- **Ephemeral state**. Ratchet state lives in memory for the session duration. Reloading
  the page requires a new session handshake. This avoids the risks of stale persisted
  ratchet state but means message history from the current session cannot be re-decrypted
  after reload.
- **Single device**. Identity keys are stored in localStorage and tied to one browser.
  There is no key sync or multi-device support.
- **Trust on first use**. Key fingerprint verification is manual and optional. The key
  transparency log records changes and the client warns on key rotation, but verification
  is ultimately the user's responsibility.
