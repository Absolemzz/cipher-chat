# Threat Model

## Trust Assumptions

- The server is honest-but-curious: it routes messages correctly but may log metadata
- Cryptographic material (ECDH identity keys, auth signing keys, JWT, peer key pins) lives in `localStorage` on a reasonably secure device
- The network is untrusted: a passive or active adversary may intercept, replay, or drop packets
- Users are responsible for verifying key fingerprints out-of-band
- Operators configure a strong `JWT_SECRET` (required at startup) and optionally `PASSWORD_PEPPER` for password hashing

## What the Server Can See

Even though the server never sees plaintext, it has visibility into:

- Message timestamps and approximate sizes (ciphertext length)
- Room membership and join times
- Which users communicate with which rooms
- Public keys (by design — required for key distribution)
- Usernames, password hashes (Argon2id), and auth public keys (SPKI DER, base64) at registration

This is metadata leakage. An honest-but-curious server cannot read messages but can
infer communication patterns.

## Security Properties

**Confidentiality**
Messages are encrypted client-side with AES-GCM-256 before transmission. The server
stores and relays only ciphertext. A server breach does not expose message contents.

**Integrity**
AES-GCM is an authenticated encryption scheme. A ciphertext that has been tampered with
will fail to decrypt and be silently dropped. This prevents message modification in transit.

**Forward secrecy**
The Double Ratchet protocol rotates key material on every conversation turn via a DH
ratchet step (fresh ephemeral ECDH key pair). Old private keys are discarded after use.
Within a turn, the symmetric chain ratchet derives a unique key per message. Compromising
a device after a ratchet step cannot recover messages encrypted under previous key pairs.

**Break-in recovery**
If an attacker temporarily compromises ratchet state, the next DH ratchet step (triggered
by the peer's next reply) re-establishes security with fresh key material the attacker
does not possess.

**Account authentication**
HTTP login and registration use a two-step flow:

1. **`POST /auth/challenge`** — server issues a short-lived, single-use challenge (5 minute TTL, stored in `auth_challenges`).
2. **`POST /auth/register` or `/auth/login`** — client proves possession of a browser-held **auth signing key** (ECDSA P-256) by signing a canonical challenge string, and proves knowledge of the account **password** (Argon2id hash on the server, minimum 12 characters). An optional server-side `PASSWORD_PEPPER` is mixed into the password before hashing.

On success the server returns a JWT (7 day expiry) signed with `JWT_SECRET`. The backend refuses to start token operations if `JWT_SECRET` is unset.

Remaining weaknesses (demo scope):

- No second factor, email verification, or recovery flow
- Usernames are first-come; anyone can register an unused name if they know the password policy
- A stolen JWT grants full API and WebSocket access until expiry
- Compromise of `localStorage` exposes auth signing keys and allows offline password guessing only against the server hash (not the signing key directly for login without also stealing the challenge flow)
- E2E identity keys are separate from auth keys; verifying a password does not prove possession of the chat identity key

**Key Authenticity**
Public keys are exchanged over the WebSocket connection and stored server-side for
bootstrapping new joiners. The server could theoretically substitute a different public
key for a user (man-in-the-middle). Three mitigations are in place:

1. **Key fingerprints**: users who compare fingerprints out-of-band can detect substitution.
   This is trust-on-first-use (TOFU), the same model used by SSH.
2. **Key transparency log**: the server maintains an append-only log of every public key
   a user has published (`key_log` table). Clients query this log when receiving a peer's
   key and compare against the last-known key stored locally. If a key change is detected,
   a visible warning banner is displayed urging out-of-band verification.
3. **Local key pinning**: the client persists the last-seen key for each peer in
   `localStorage`. Cross-session key changes are detected automatically.

The log and pinning detect changes; they do not cryptographically prove log integrity
(no Merkle commitments or signed tree heads).

**Input Validation**
All HTTP route inputs are validated with Zod schemas before reaching controller logic.
Invalid payloads receive a 400 response with structured error details.

**DoS Protection**
Rate limiting is applied at the HTTP layer (200 requests per 15 minutes per IP).
WebSocket connections require a valid JWT. The skipped-message key cache is bounded at
100 entries to prevent resource exhaustion from fabricated message numbers.

## Limitations

**Forward secrecy (per-turn, not per-message)**
The Double Ratchet provides forward secrecy at the granularity of conversation turns.
Each time the sender switches (Alice → Bob or Bob → Alice), a new DH ratchet step
generates fresh ephemeral keys and discards old ones. Within a single turn, the
symmetric chain ratchet derives a unique key per message, but all message keys in that
turn trace back to the same chain key. Compromising the device mid-turn exposes the
remaining messages in that turn (but not previous turns or future turns after the next
DH ratchet step).

**Break-in recovery**
If an attacker gains temporary access to ratchet state, security is restored on the next
DH ratchet step (triggered by the peer's reply). This is a property of the DH ratchet
but requires the attacker to lose access before the next turn.

**Ephemeral ratchet state**
Ratchet state is held in memory only and is not persisted to localStorage or IndexedDB.
If the user reloads the page or closes the tab, the ratchet state is lost and a new
session handshake is required. This is a deliberate trade-off: persisting ratchet state
introduces risks of state desynchronization and stale key material, while the ephemeral
approach matches the current session model (both users must be online to re-establish).

**No X3DH**
There is no prekey bundle mechanism. Both users must be online simultaneously to establish
a session. Offline message initiation is not supported.

**Two-party rooms (design limit, not enforced)**
The Double Ratchet is a pairwise protocol. The UI and client state assume a single peer
per room. The server does not reject a third member; additional joiners can break E2E for
everyone because only one `recipientPublicKey` is tracked.

**No metadata protection**
Message timing, size, and room membership are visible to the server and any network
observer. Padding and cover traffic would reduce size leakage; a mixnet would reduce
timing correlation.

**Single device**
Identity and auth signing keys live in `localStorage` in one browser. There is no
mechanism to sync keys across devices or recover them if `localStorage` is cleared.

**Open registration**
Any unused username can be registered with a password and browser-generated auth key.
There is no global identity provider or proof of real-world identity. Username squatting
and phishing-style registration remain possible until users verify fingerprints out-of-band.

**Unauthenticated public key lookup**
`GET /users/:userId/public-key` does not require a JWT. Anyone who knows or guesses a user
UUID can fetch the current chat public key. This simplifies bootstrapping but increases
metadata exposure and enables passive key harvesting.

**No message deletion**
The server retains all ciphertext indefinitely. There is no expiry, deletion, or
disappearing message mechanism.

## Out of Scope

- Multi-party rooms with per-recipient encryption
- Anonymity or traffic analysis resistance
- X3DH / offline session initiation
- Ratchet state persistence across page reloads
- Cryptographic proofs over the key log (e.g. Merkle tree commitments)
- Enforcing a two-member cap per room at the API layer
