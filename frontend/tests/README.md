# Frontend Tests

Frontend tests using Vitest, Testing Library, and the Web Crypto API.

## Running

```bash
cd frontend
npm test
```

## Coverage

### Transport URLs (5 tests)

- Same-origin `/api` URL construction
- Same-origin `/ws` WebSocket construction
- `http` to `ws` and `https` to `wss` protocol derivation
- Vite env override behavior

### ChatRoom integration (27 tests)

- WebSocket auth and room join without server history fetch
- Outbox queueing, flush on readiness, retry after socket close, and offline-peer send semantics
- Live session establishment, ciphertext send, delivery acks, and duplicate-relay handling
- Multi-room switching: pending outbox isolation, cross-room inbound queue, rapid A→B→A flush
- Local transcript restore after remount and live decrypt after refresh
- Room switching preserves encrypted local state; only intentional leave/delete clears it
- Unverified peer state and safety-number modal
- Mark peer as verified
- Verified state survives refresh, and peer key changes reset verification

### Local encrypted persistence (5 tests)

- AES-GCM IndexedDB message roundtrip without plaintext in stored records
- Fresh IV/ciphertext for repeated message content
- User logout cleanup removes local records and encryption keys
- Peer verification persists for the same peer key
- Peer verification does not apply after the peer key fingerprint changes

### Safety numbers (3 tests)

- Stable grouped numeric output for the same identity keys
- Symmetric participant ordering
- Changed peer identity keys produce changed safety numbers and peer-key fingerprints

### Key fingerprints (3 tests)

- Format validation (colon-separated uppercase hex), deterministic for the same key, unique across different keys

### Double Ratchet (22 tests)

- **Basic roundtrip:** encrypt/decrypt across participants; either side can send the first message
- **Message content:** unicode, emoji, empty strings
- **Symmetric ratchet:** multiple messages in the same direction without DH ratchet
- **DH ratchet:** turn-taking triggers DH key rotation, extended multi-turn conversations
- **Out-of-order delivery:** skipped message keys cached and used on arrival, including across DH ratchet boundaries (exercising the `pn` field)
- **DoS protection:** skipping more than MAX_SKIP (100) messages is rejected
- **Forward secrecy:** consumed chain keys cannot decrypt the same message again, root key evolves after DH ratchet steps
- **Integrity:** tampered ciphertext rejected, tampered headers rejected
- **AEAD binding:** header-swap attacks detected (ciphertext from one header cannot authenticate under a different header)
- **Session immutability on failure:** failed decryption does not mutate session state
- **Serialization:** persisted ratchet sessions can resume live decryption, including skipped message keys
