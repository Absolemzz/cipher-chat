<div align="center">

# Cipher Chat

End-to-end encrypted messaging with a Double Ratchet protocol implementation built from scratch using the Web Crypto API. The server is a ciphertext relay — it never sees plaintext or private keys.

![React](https://img.shields.io/badge/React-20232A?style=flat&logo=react&logoColor=61DAFB)
![TypeScript](https://img.shields.io/badge/TypeScript-20232A?style=flat&logo=typescript&logoColor=3178C6)
![Node.js](https://img.shields.io/badge/Node.js-20232A?style=flat&logo=nodedotjs&logoColor=3C873A)
![SQLite](https://img.shields.io/badge/SQLite-20232A?style=flat&logo=sqlite&logoColor=0F80CC)
![Docker](https://img.shields.io/badge/Docker-20232A?style=flat&logo=docker&logoColor=2496ED)
![WebCrypto](https://img.shields.io/badge/Web%20Crypto%20API-20232A?style=flat&logo=webauthn&logoColor=white)

</div>

## Quick Start

```bash
docker compose up --build
```

Open `http://localhost:3000`. Register two users in separate browser tabs, create a room, share the room code, and start messaging.

## Cryptographic Protocol

The crypto layer implements the Double Ratchet Algorithm (the same protocol design used by Signal) entirely in the browser via the Web Crypto API. No third-party crypto libraries are used.

**Key exchange and session initialization:**
- Identity keys: ECDH over P-256, generated at registration
- Initial shared secret: ECDH + HKDF-SHA-256 (salt = 32 zero bytes, info = `session_root_v1`)
- Role determination: lexicographic comparison of base64 public keys (no extra round-trip)
- Initiator performs the first DH ratchet step immediately; responder activates on first message

**Double Ratchet:**
- DH ratchet: fresh ephemeral P-256 key pair generated on every conversation turn, old private keys discarded
- Symmetric ratchet: `KDF_CK` via HMAC-SHA-256 with single-byte constants (`0x01` for message key, `0x02` for next chain key)
- Root key ratchet: `KDF_RK` via HKDF-SHA-256 (ikm = DH output, salt = root key, info = `ratchet_rk`)
- Encryption: AES-GCM-256 with random 12-byte IV per message
- AEAD: message header (`dh || pn || n`) serialized as `additionalData`, binding header to ciphertext
- Skipped message keys: cached for out-of-order delivery, bounded at 100 entries (DoS protection)

**Key verification:**
- SHA-256 fingerprints (first 8 bytes, colon-separated hex) displayed in the UI
- Append-only key transparency log on the server — clients detect and warn on key changes across sessions

See [`crypto-spec/key-exchange.md`](crypto-spec/key-exchange.md) for the full protocol specification and [`crypto-spec/threat-model.md`](crypto-spec/threat-model.md) for the security analysis.

## Architecture

```
frontend/                React 18 + TypeScript (strict) + Tailwind
  src/crypto/            Double Ratchet, ECDH, HKDF, AES-GCM — all Web Crypto API
  src/pages/             Chat UI with key transparency warnings

backend/src/             Node.js + Express + WebSocket (ws) + SQLite
  routes/                HTTP endpoints with Zod schema validation
  controllers/           Request orchestration
  services/              Business logic and authorization
  models/                SQLite data access (better-sqlite3, WAL mode)
  middleware/            JWT auth + Zod validation
  websocket/             Modular WS: auth, routing, room state, persistence

crypto-spec/             Protocol design docs and threat model
infra/                   CI workflow (GitHub Actions)
```

**Backend design:** layered architecture (route → controller → service → model) with centralized error handling. The WebSocket layer is split into four modules: connection auth, message routing, room state management, and persistence — each with a single responsibility.

**Security controls:**
- WebSocket: first-message JWT auth (not in URL), per-connection rate limiting, 64KB payload cap, room membership enforcement on every action
- HTTP: rate limiting (200 req / 15 min per IP), Zod validation on all route inputs
- Key transparency: append-only `key_log` table, client-side key pinning in `localStorage`
- Docker: multi-stage builds, non-root containers, named volumes, health checks

## Testing

| Layer | Framework | Tests |
|-------|-----------|-------|
| Backend API | Vitest + Supertest | 40 (auth, keys, rooms, key log, input validation) |
| Backend WebSocket | Vitest + ws | 9 (auth, authorization, message relay) |
| Frontend crypto (legacy) | Vitest + Web Crypto | 18 (ECDH, HKDF, AES-GCM, fingerprints) |
| Frontend Double Ratchet | Vitest + Web Crypto | 19 (ratchet roundtrip, forward secrecy, out-of-order, AEAD, DoS bounds) |

```bash
cd backend && npm test      # API + WebSocket tests
cd frontend && npm test     # Crypto + Double Ratchet tests
```

## Known Limitations

These are deliberate scope decisions, documented in the [threat model](crypto-spec/threat-model.md):

- **No X3DH** — both users must be online to establish a session (no prekey bundles for offline initiation)
- **Ephemeral ratchet state** — ratchet state lives in memory; page reload requires a new session handshake
- **Single device** — identity keys are in `localStorage`, no multi-device sync
- **2-party only** — the ratchet operates between exactly two peers per room
- **Trust on first use** — key verification is manual; the transparency log detects changes but doesn't enforce a PKI

## License

MIT
