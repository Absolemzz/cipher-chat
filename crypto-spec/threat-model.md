# Threat Model

## Assumptions
- Server routes messages but may log metadata (honest-but-curious)
- Private keys stored locally on reasonably secure devices
- Network adversary can intercept, replay, or drop packets

## Security Analysis
- **Authentication**: JWT tokens are weak in demo - production needs strong auth
- **Integrity**: Messages protected by AES-GCM (demo) and authenticated encryption (production)
- **Confidentiality**: Server stores ciphertext only, cannot read message contents
- **Metadata**: Timestamps, room membership, message sizes visible to server
- **DoS Protection**: Basic rate limiting - production needs quota and abuse mitigation
- **Privilege**: Clients have no admin access, critical operations server-side only

## Current Limitations
- No metadata protection
- Single-device model (no key sync)
- No backup/recovery system

## Production Requirements
- Secure key storage (OS keystore)
- X25519 + Double Ratchet implementation
- Metadata protection if required (padding, mixnets)