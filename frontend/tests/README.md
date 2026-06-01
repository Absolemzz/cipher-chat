# Frontend Tests

Crypto unit tests using Vitest with the Web Crypto API.

## Running

```bash
cd frontend
npm test
```

## Coverage

### Key fingerprints (3 tests)

- Format validation (colon-separated uppercase hex), deterministic for the same key, unique across different keys

### Double Ratchet (20 tests)

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
