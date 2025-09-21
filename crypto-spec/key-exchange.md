# Key Exchange

## Demo Mode
Uses shared symmetric key with AES-GCM for simplicity. Easy to understand but lacks forward secrecy and per-user confidentiality.

## Production Design
Would implement X3DH-style handshake:
- Long-term identity keys (X25519) + signed pre-keys + ephemeral one-time keys
- ECDH key combinations derive shared secrets
- Double Ratchet for forward secrecy

Current implementation uses simplified ECDH with P-256 as placeholder.