# Threat Model

## Trust Assumptions

- The server is honest-but-curious: it routes messages correctly but may log metadata
- Private keys are stored in localStorage on a reasonably secure device
- The network is untrusted: a passive or active adversary may intercept, replay, or drop packets
- Users are responsible for verifying key fingerprints out-of-band

## What the Server Can See

Even though the server never sees plaintext, it has visibility into:

- Message timestamps and approximate sizes (ciphertext length)
- Room membership and join/leave times
- Which users communicate with which rooms
- Public keys (by design — required for key distribution)

This is metadata leakage. An honest-but-curious server cannot read messages but can
infer communication patterns.

## Security Properties

**Confidentiality**
Messages are encrypted client-side with AES-GCM-256 before transmission. The server
stores and relays only ciphertext. A server breach does not expose message contents.

**Integrity**
AES-GCM is an authenticated encryption scheme. A ciphertext that has been tampered with
will fail to decrypt and be silently dropped. This prevents message modification in transit.

**Authentication**
Users authenticate with JWT tokens signed with a server-side secret. Tokens expire after
7 days. This is adequate for a demo but has weaknesses: there is no password or second
factor, and username registration is open with no identity verification. A stolen token
grants full account access until expiry.

**Key Authenticity**
Public keys are exchanged over the WebSocket connection and stored server-side for
bootstrapping new joiners. The server could theoretically substitute a different public
key for a user (man-in-the-middle). Key fingerprints mitigate this: users who compare
fingerprints out-of-band can detect substitution. This is trust-on-first-use (TOFU),
the same model used by SSH.

**DoS Protection**
Rate limiting is applied at the HTTP layer (200 requests per 15 minutes per IP).
WebSocket connections require a valid JWT. This provides basic protection but not
quota enforcement or abuse mitigation at scale.

## Limitations

**Partial forward secrecy**
Each message is encrypted with a unique AES-GCM-256 key derived from the session root
and a per-message index via HKDF. A compromised message key does not expose other
messages. However, the session root is derived once per session from a static ECDH key
pair — if the private key is compromised, an attacker can re-derive the session root
and all per-message keys. A Double Ratchet implementation would replace the session
root on each message exchange, eliminating this risk.

**No metadata protection**
Message timing, size, and room membership are visible to the server and any network
observer. Padding and cover traffic would reduce size leakage; a mixnet would reduce
timing correlation.

**Single device**
Keys live in localStorage in one browser. There is no mechanism to sync keys across
devices or recover them if localStorage is cleared.

**Open registration**
Any username can be registered without a password or proof of identity. This is
intentional for the demo but means account impersonation is trivial before a key
fingerprint has been verified.

**No message deletion**
The server retains all ciphertext indefinitely. There is no expiry, deletion, or
disappearing message mechanism.

## Out of Scope

- Protection against a malicious server that actively replaces public keys
  (requires a transparency log or out-of-band PKI)
- Multi-party rooms with per-recipient encryption
- Anonymity or traffic analysis resistance