# Cipher chat Backend

Backend service for Cipher chat, an end-to-end encrypted chat application. This service is intentionally designed as a live ciphertext relay and metadata coordinator: clients handle encryption/decryption and local encrypted transcript persistence, while the backend handles authentication, room membership, and WebSocket fan-out.

## Overview

- Runtime: Node.js (CommonJS)
- API: Express HTTP server
- Realtime: WebSocket (`ws`)
- Persistence: SQLite (`better-sqlite3`)
- Auth: JWT bearer tokens
- Logging and hardening: Pino structured logs, request IDs, explicit CORS, Helmet, rate limiting
- Input validation: Zod schemas on all route inputs
- Testing: Vitest + supertest/ws (API and WebSocket integration tests)

## Architecture

The backend follows a layered architecture for HTTP features:

- **Route**: URL mapping only
- **Controller**: request/response orchestration and auth extraction
- **Service**: business logic and orchestration
- **Model**: direct database access (synchronous `better-sqlite3`)

### Layered Request Flow

1. Route receives request. `requireAuth` middleware validates the JWT and sets `req.user`. Zod `validate` middleware checks request body/params against the route's schema.
2. Controller extracts parameters and delegates to the service layer.
3. Service executes business logic (authorization, validation) and calls model methods.
4. Model executes SQL synchronously and returns data.
5. On error, controllers call `next(error)` and the centralized error middleware returns a consistent JSON envelope.

## WebSocket Modular Design

WebSocket handling is split into three focused modules:

- **`websocket/server.js`** (The Bouncer)
  - Creates `WebSocket.Server` with `maxPayload: 64KB` to reject oversized frames
  - Handles connection lifecycle with first-message auth protocol (no token in URL)
  - Clients must send `{ type: "auth", token: "..." }` as their first message within 5 seconds
  - Registers authenticated sockets in `connectionsByUser` for member-based relay
  - Per-connection message rate limiting (20 messages/second sliding window)
  - Delegates message payloads to `router.js`
  - Delegates disconnect cleanup to `roomHandler.js`

- **`websocket/router.js`** (The Switchboard)
  - Parses inbound payloads
  - Uses message `type` routing (`join`, `public_key`, `ciphertext`, `message.delivered`)
  - Dispatches to room handler functions
  - Handles invalid payloads safely

- **`websocket/roomHandler.js`** (The Broadcaster and State Manager)
  - Owns in-memory room state: `Map<roomId, Set<ws>>` for join-scoped actions, plus `connectionsByUser` for relay
  - Enforces room existence and membership on every action (join, public_key, ciphertext, delivery acks)
  - Authorization model matches REST: `Room.isUserInRoom` is checked per operation
  - Relays ciphertext to all open sockets of other room members, not only clients that have joined that room
  - Persists accepted client message ids in memory for dedupe and delivery-ack forwarding
  - Bootstraps peer public keys for joiners

This separation keeps connection concerns, message routing, and in-memory realtime state isolated and easier to evolve independently. The server does not persist message ciphertext; clients own local encrypted transcript and ratchet persistence.

## Directory Layout

```text
backend/
  src/
    server.js                 # Entry point: HTTP server + WebSocket attach + listen
    app.js                    # Express app wiring (middleware + router mounts)
    db.js                     # SQLite initialization + schema bootstrap
    logger.js                 # Pino logger with sensitive-field redaction
    metrics.js                # Prometheus-compatible metrics registry
    middleware/
      auth.js                 # JWT verification helper + requireAuth middleware
      validate.js             # Zod-based request validation middleware
    schemas.js                # Zod schemas for all route inputs
    routes/
      auth.js                 # /auth endpoints
      rooms.js                # /rooms endpoints
      users.js                # /users endpoints
      keys.js                 # /keys endpoints
    controllers/
      authController.js
      roomsController.js
      usersController.js
      keysController.js
    services/
      authService.js
      roomService.js
      userService.js
      keyService.js
    models/
      User.js
      Room.js
    websocket/
      server.js
      router.js
      roomHandler.js
  data/
    messages.db               # SQLite file created at runtime
  package.json
```

## Data Model

SQLite schema is initialized in `src/db.js` with WAL journal mode enabled:

- `users(id, username, password_hash, public_key, auth_public_key)`
- `rooms(id, code)`
- `user_rooms(user_id, room_id, joined_at, PRIMARY KEY(user_id, room_id))`
- `key_log(id AUTOINCREMENT, user_id, public_key, published_at)` — append-only key transparency log

Schema setup runs on import, so importing `db.js` ensures bootstrap is executed exactly once per process.

## HTTP API Surface

- `GET /healthz` — health check (no auth)
- `GET /metrics` — Prometheus-compatible metrics (no auth)
- `POST /auth/register` — create account (no auth)
- `POST /auth/login` — get token (no auth)
- `POST /rooms` — create room (auth)
- `GET /rooms/:code` — join room by invite code (auth)
- `GET /rooms/:roomId/messages` — deprecated server history endpoint; members receive 410 because history replay is disabled
- `GET /users/:userId/rooms` — list own rooms (auth + ownership)
- `DELETE /users/:userId/rooms/:roomId` — leave room (auth + ownership)
- `GET /users/:userId/public-key` — get user's public key (no auth)
- `POST /keys/publish` — publish own public key (auth + ownership, appends to key log)
- `GET /keys/:userId/log` — get user's key transparency log (auth)

## WebSocket Message Types

Inbound message `type` values:

- `auth` — first message required, carries JWT token (replaces query-string auth)
- `join` — join a room (requires membership via REST)
- `public_key` — broadcast public key to room peers
- `ciphertext` — send encrypted message
- `message.delivered` — recipient acknowledges decrypt/render of a relayed message

Outbound server message patterns include:

- `auth_ok` — authentication succeeded
- `joined` — room join confirmed
- `public_key` — peer's public key
- `ciphertext` — relayed encrypted message
- `message.accepted` — sender acknowledgement with relay metadata
- `message.delivered` — forwarded recipient delivery acknowledgement
- `error` — auth failure, authorization denial, rate limit, etc.

## Running Locally

### Prerequisites

- Node.js 18+ recommended
- npm

### Install and start

```bash
cd backend
npm install
npm start
```

Server starts on:

- `process.env.BACKEND_PORT` if set
- otherwise `4000`

## Environment Variables

- `BACKEND_PORT` (default `4000`)
- `LOG_LEVEL` (optional Pino level; tests default to silent)
- `METRICS_TOKEN` (optional; when set, `GET /metrics` requires `Authorization: Bearer <token>`)
- `JWT_SECRET` (required; the backend refuses to sign or verify tokens without it)
- `PASSWORD_PEPPER` (optional; appended before Argon2id password hashing)
- `DB_PATH` (default `./data/messages.db`, use `:memory:` for tests)
- `ALLOWED_ORIGINS` (optional comma-separated CORS allowlist; production defaults to none)
- `TRUST_PROXY` (optional Express trust proxy setting; use `1` for a single nginx hop)

Set `JWT_SECRET` to a strong random value before running the backend.
If you set `PASSWORD_PEPPER`, keep it stable; rotating it invalidates existing passwords.

## Observability

- HTTP requests get an `x-request-id`. A provided `x-request-id` is preserved; otherwise the backend generates a UUID. The same ID is attached to `req.id`, response headers, request completion logs, and error logs.
- Logs are structured JSON from Pino. Test runs are silent by default. The redaction policy removes authorization headers, cookies, JWTs, passwords, auth challenges, signatures, public/private key payload fields, plaintext/ciphertext fields, and similar sensitive values.
- Request logs include method, path, templated route when available, status, duration, request ID, and authenticated user ID when present.
- Error logs include request ID and safe request context. Production 500 responses stay generic and do not expose stack traces.
- `GET /metrics` returns Prometheus text with process metrics, HTTP request counters/duration histograms, auth endpoint outcome counters, WebSocket active connection gauge, WebSocket message counters, and WebSocket error counters. Metric labels avoid user IDs, room IDs, request IDs, and raw paths.
- `/metrics` is intended for internal scraping only. In the production-shaped Docker stack, scrape the backend service on the internal Docker network at `http://backend:4000/metrics`; do not expose it publicly.
- Set `METRICS_TOKEN` in production-like environments to require `Authorization: Bearer <token>` on direct `/metrics` requests. Leave it unset for simple local development/test access.
- The frontend nginx entrypoint blocks public `/api/metrics` so the broad `/api/` proxy cannot accidentally expose backend metrics.
- `GET /healthz` is the lightweight health check used by Docker. `/metrics` is telemetry for scraping and should not be treated as readiness.

## Operational Notes

- Database access is synchronous (`better-sqlite3`) by design. WAL journal mode is enabled for better read concurrency.
- Service/controller functions are `async` for uniformity across layers and future async extensibility.
- HTTP rate limiting is enabled globally at app level (200 req / 15 min per IP).
- The default rate-limit store is in-memory and intended for single-instance/local deployments; multi-instance production needs a shared store.
- WebSocket rate limiting is per-connection (20 messages/second). Payload size capped at 64KB.
- WebSocket authorization mirrors REST: room existence and membership are checked on every action.
- This backend stores users, rooms, memberships, and key logs. It does not persist message ciphertext.
- Centralized error middleware catches all errors and returns consistent `{ error }` JSON envelopes.
- Graceful shutdown on SIGTERM/SIGINT: drains WebSocket connections, closes HTTP server, closes database.
- Docker healthcheck polls `GET /healthz`; the frontend container waits for `service_healthy`.

## Future work

- Merkle tree commitments over the key transparency log.
