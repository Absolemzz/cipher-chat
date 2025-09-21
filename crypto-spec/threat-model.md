# Threat Model (Signal-lite Demo)

## Assumptions
- Server is *honest-but-curious*: it will route messages but may log metadata.
- Clients run on reasonably secure devices; private keys stored locally (IndexedDB/localStorage in demo).
- Network adversary can intercept, replay, or drop packets.

## STRIDE Analysis (high-level)
- Spoofing: JWT demo tokens are weak — production must use strong auth and account recovery.
- Tampering: Messages are integrity-protected by AES-GCM (demo) and by authenticated encryption in prod design.
- Repudiation: Messages can be logged client-side; server stores ciphertext-only and cannot read contents.
- Information Disclosure: Metadata (timestamps, room membership, message sizes) are visible to server.
- Denial of Service: Rate limiting is present but minimal; production should include quota & abuse mitigation.
- Elevation of Privilege: Clients never receive server admin keys; critical operations are server-side only.

## Limitations
- Metadata protection not implemented.
- Single-device model: key sync between devices not implemented.
- Recovery uses encrypted backup (not implemented in demo scaffold).

## Recommendations for production
- Use secure key storage (OS-backed keystore), protect backups using strong KDF.
- Use X25519 + Double Ratchet (libolm / libsignal) or audited libraries.
- Add metadata protection (padding, onion routing or mixnets) if needed.
