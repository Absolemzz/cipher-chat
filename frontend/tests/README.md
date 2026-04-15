# Frontend Tests

Crypto unit tests using Vitest with the Web Crypto API.

## Running

```bash
cd frontend
npm test
```

## Coverage

### Legacy crypto (18 tests)

- **Session root derivation:** ECDH commutativity, different peers produce different roots, deterministic for same inputs
- **Per-message keys:** different indices produce different keys, same index is deterministic, negative/fractional index rejection
- **Encrypt/decrypt roundtrip:** basic plaintext, unicode + emoji, empty string, sequential messages, out-of-order decryption
- **Ciphertext integrity:** tampered ciphertext rejected (AES-GCM authentication), wrong session root rejected, random IV uniqueness
- **Key fingerprints:** format validation (colon-separated hex), deterministic, unique per key

### Double Ratchet (19 tests)

- **Basic roundtrip:** encrypt/decrypt across initiator and responder
- **Message content:** unicode, emoji, empty strings
- **Symmetric ratchet:** multiple messages in the same direction without DH ratchet
- **DH ratchet:** turn-taking triggers DH key rotation, extended multi-turn conversations
- **Out-of-order delivery:** skipped message keys cached and used on arrival, including across DH ratchet boundaries (exercising the `pn` field)
- **DoS protection:** skipping more than MAX_SKIP (100) messages is rejected
- **Forward secrecy:** consumed chain keys cannot decrypt the same message again, root key evolves after DH ratchet steps
- **Integrity:** tampered ciphertext rejected, tampered headers rejected
- **AEAD binding:** header-swap attacks detected (ciphertext from one header cannot authenticate under a different header)
- **Session immutability on failure:** failed decryption does not mutate session state
