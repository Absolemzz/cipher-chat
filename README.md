<div align="center">

# Cipher chat

An end-to-end encrypted messaging app. Encryption and decryption happen entirely in the browser — the server never sees plaintext or private keys.

![React](https://img.shields.io/badge/React-20232A?style=flat&logo=react&logoColor=61DAFB)
![TypeScript](https://img.shields.io/badge/TypeScript-20232A?style=flat&logo=typescript&logoColor=3178C6)
![Node.js](https://img.shields.io/badge/Node.js-20232A?style=flat&logo=nodedotjs&logoColor=3C873A)
![SQLite](https://img.shields.io/badge/SQLite-20232A?style=flat&logo=sqlite&logoColor=0F80CC)
![Docker](https://img.shields.io/badge/Docker-20232A?style=flat&logo=docker&logoColor=2496ED)
![WebCrypto](https://img.shields.io/badge/Web%20Crypto%20API-20232A?style=flat&logo=webauthn&logoColor=white)

</div>

## Quick Start
```bash
docker-compose up --build
```

Open `http://localhost:3000`. Register two users in separate browser sessions, create a room, share the room code, and start messaging.

## How It Works

When a user registers, the client generates a P-256 key pair. The public key is published to the server. The private key never leaves the client.

When a message is sent, the sender derives a shared session root using ECDH and HKDF. Each message gets a unique AES-GCM-256 key derived from the session root and a per-message index. The recipient derives the same keys independently. The server only sees the encrypted payload.

Each public key is fingerprinted (SHA-256, first 8 bytes, hex) and displayed in the UI so users can verify identities out-of-band.

## Crypto

- Key exchange: ECDH over P-256
- Session root: HKDF with `info = "session_root_v1"`
- Per-message keys: HKDF with `info = "msg_key_v1_<idx>"` — each message key is independent
- Encryption: AES-GCM-256 with a random 12-byte IV per message (nonce)
- Key fingerprints: SHA-256 of raw public key (first 8 bytes, hex)

See [`crypto-spec/key-exchange.md`](crypto-spec/key-exchange.md) and [`crypto-spec/threat-model.md`](crypto-spec/threat-model.md) for full protocol and security details.

## Project Structure
```
frontend/          React app, crypto layer (src/crypto/), components
backend/src/       Express + WebSocket relay server
  routes/          HTTP route handlers
  middleware/      Auth middleware
  websocket/       WebSocket connection and message handling
  db.js            Database init and schema
crypto-spec/       Protocol design and threat model
```

## Known Limitations & Future Work

- Partial forward secrecy — per-message keys are independent, but the session root is derived from a static key pair. A Double Ratchet would eliminate this.
- Single device — keys live in localStorage with no sync or recovery
- Trust on first use — fingerprint verification is manual, no PKI
- Open registration — no password or identity verification

## License

MIT
