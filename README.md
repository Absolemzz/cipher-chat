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

---

## Quick Start

```bash
docker compose up --build
```

Open `http://localhost:3000`. Register two users in separate browser tabs, create a room, share the room code, and start messaging.

---

## Transport and Deployment

The browser uses same-origin transport by default:

- HTTP API calls go to `/api/...`
- WebSocket connects to `/ws`
- WebSocket protocol is derived from the page: `http` uses `ws`, `https` uses `wss`

In Docker, the frontend nginx container is the public entrypoint on port `3000`. It serves the built React app, proxies `/api/` to the backend service, and proxies `/ws` with WebSocket upgrade headers. The backend is addressed internally as `backend:4000` and is not published on the host by default.

The public nginx entrypoint blocks `/api/metrics`. Prometheus-compatible metrics are intended for internal scraping from the Docker network at `http://backend:4000/metrics`; set `METRICS_TOKEN` to require a bearer token on that backend endpoint.

For local frontend development, Vite proxies `/api` and `/ws` to `VITE_DEV_BACKEND_URL` or `http://localhost:4000`. You can override browser-facing endpoints with `VITE_API_BASE_URL` and `VITE_WS_BASE_URL`, but the default path needs no source edits.

Backend CORS is explicit: production expects same-origin nginx proxying, while local development allows `http://localhost:3000` and `http://127.0.0.1:3000` unless `ALLOWED_ORIGINS` is set. `TRUST_PROXY=1` is used for the Docker nginx hop; multi-proxy deployments should set it deliberately.

---

## Cryptographic Protocol

The crypto layer implements the **Double Ratchet Algorithm** — the same protocol design used by Signal — entirely in the browser via the Web Crypto API. No third-party crypto libraries.

ECDH P-256 for key agreement, HKDF-SHA-256 for root key derivation, HMAC-SHA-256 for chain key ratcheting, and AES-GCM-256 for authenticated encryption with header binding via AEAD `additionalData`. Fresh ephemeral key pairs are generated on every conversation turn; old private keys are discarded.

> [!NOTE]
> Full protocol specification in [`crypto-spec/key-exchange.md`](crypto-spec/key-exchange.md).
> Security analysis and threat model in [`crypto-spec/threat-model.md`](crypto-spec/threat-model.md).

---

## Safety Numbers

Each room shows the current peer trust state once a peer identity key is available. Use **View safety number** to compare the grouped number with the peer over another channel, then mark that exact peer key as verified.

Verification is stored locally in encrypted IndexedDB and is bound to the current user, room, peer user, peer identity-key fingerprint, and safety-number version. If the peer identity key changes, the previous verification no longer applies and the UI shows a key-changed/reset state until the new number is compared out-of-band.

This is manual TOFU verification. It makes key trust explicit, but it is not Merkle key transparency or a server-enforced PKI.

---

## Architecture

Browser: React for UI; Double Ratchet and Web Crypto run only here. Sensitive material does not go to the server.

Server: Node. Express for HTTP (auth, rooms, key log). WebSocket for live relay (authenticated, rate-limited). SQLite (WAL) for persistence.

The server never sees message plaintext or private ratchet keys. It also does not retain server-side message history; clients persist their own local encrypted transcript and ratchet state.

> [!NOTE]
> HTTP routes, WebSocket modules, and persistence: [`backend/README.md`](backend/README.md).

---

## Developer Workflow

Install dependencies per package:

```bash
cd backend && npm install
cd frontend && npm install
```

Useful checks:

```bash
cd backend  && npm test && npm run lint && npm run format:check
cd frontend && npm test && npx tsc --noEmit && npm run lint && npm run format:check && npm run build
```

To apply formatting or safe lint fixes:

```bash
cd backend  && npm run format && npm run lint:fix
cd frontend && npm run format && npm run lint:fix
```

---

## Testing

Automated tests cover the backend API/WebSocket layer and frontend chat/crypto/transport behavior:

| Layer                         | Framework                | Count | Coverage                                                                                                                                                   |
| ----------------------------- | ------------------------ | :---: | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backend API                   | Vitest + Supertest       |  43   | Password + signed-challenge auth, keys, rooms, key transparency log, Zod validation                                                                        |
| Backend WebSocket             | Vitest + ws              |  17   | Auth handshake, room authorization, member-based relay, delivery acks, no server-side ciphertext retention                                                 |
| Frontend transport            | Vitest                   |   5   | Same-origin API/WebSocket URLs, protocol derivation, env overrides                                                                                         |
| Frontend app state            | Vitest                   |   2   | Session restore from stored token/user state                                                                                                               |
| Frontend ChatRoom integration | Vitest + Testing Library |  27   | WebSocket auth/join, outbox/retry, multi-room switch, cross-room inbound queue, live encrypted send/delivery, local transcript restore, safety-number verification UI |
| Frontend local persistence    | Vitest + fake-indexeddb  |   5   | AES-GCM IndexedDB storage, fresh IVs, logout cleanup, peer verification key binding                                                                        |
| Frontend safety numbers       | Vitest + Web Crypto      |   3   | Deterministic grouped safety numbers, symmetric participant ordering, key-change behavior                                                                  |
| Frontend crypto               | Vitest + Web Crypto      |   3   | Key fingerprints                                                                                                                                           |
| Double Ratchet                | Vitest + Web Crypto      |  22   | Bidirectional first message, forward secrecy, out-of-order, AEAD binding, DoS bounds, session serialization                                                |

```bash
cd backend  && npm test     # API + WebSocket tests
cd frontend && npm test     # Crypto + Double Ratchet tests
```

---

## Project Structure

- **`.github/workflows/`** — CI on push/PR: backend/frontend tests, TypeScript check, production `npm audit`, Docker build
- **`crypto-spec/`** — Protocol specification ([`key-exchange.md`](crypto-spec/key-exchange.md)) and [threat model](crypto-spec/threat-model.md)
- **`frontend/src/`**
  - `lib/localEncryptedStore.ts` - IndexedDB AES-GCM storage for local transcript and serialized ratchet state
  - `crypto/` — Double Ratchet, ECDH, HKDF, AES-GCM (Web Crypto API only)
  - `pages/` — `Login.tsx`, `ChatRoom.tsx` (key transparency warnings)
  - `components/` — Room selector and shared UI
- **`backend/src/`**
  - `routes/` — HTTP API (`auth`, `rooms`, `keys`, `users`)
  - `controllers/` — Request handlers
  - `services/` — Auth (Argon2 + signed challenge), rooms, key transparency log
  - `models/` — SQLite via better-sqlite3 (WAL)
  - `middleware/` — JWT verification and Zod validation
  - `logger.js`, `metrics.js` - structured logs, request IDs, Prometheus metrics
  - `websocket/` — Authenticated relay, rate limits, room state
- **`docker-compose.yml`** — Local stack (frontend nginx + backend API)
- **`.env.example`** — Required env vars (`JWT_SECRET`, optional `PASSWORD_PEPPER`)

---

## Known Limitations

Deliberate scope decisions, documented in the [threat model](crypto-spec/threat-model.md):

| Limitation                      | Rationale                                                                                                       |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| **No X3DH**                     | Both users must be online — no prekey bundles for offline session initiation                                    |
| **Local-only chat persistence** | Ratchet state and transcript are encrypted in browser IndexedDB; the server does not replay old message history |
| **Single device**               | Identity keys in `localStorage`, no multi-device sync                                                           |
| **2-party only**                | Ratchet operates between exactly two peers per room                                                             |
| **Trust on first use**          | Safety numbers support manual verification; transparency log detects changes but doesn't enforce a PKI          |
