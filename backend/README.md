# Cipher chat Backend

Backend service for Cipher chat, an end-to-end encrypted chat application. This service is intentionally designed as a ciphertext relay and metadata coordinator: clients handle encryption/decryption, while the backend handles authentication, room membership, message persistence, and WebSocket fan-out.

## Overview

- Runtime: Node.js (CommonJS)
- API: Express HTTP server
- Realtime: WebSocket (`ws`)
- Persistence: SQLite (`better-sqlite3`)
- Auth: JWT bearer tokens
- Logging and hardening: `morgan`, CORS, rate limiting
- Input validation: Zod schemas on all route inputs
- Testing: Vitest + supertest (40 API tests + 9 WebSocket integration tests)

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

WebSocket handling is split into four focused modules:

- **`websocket/server.js`** (The Bouncer)
  - Creates `WebSocket.Server` with `maxPayload: 64KB` to reject oversized frames
  - Handles connection lifecycle with first-message auth protocol (no token in URL)
  - Clients must send `{ type: "auth", token: "..." }` as their first message within 5 seconds
  - Per-connection message rate limiting (20 messages/second sliding window)
  - Delegates message payloads to `router.js`
  - Delegates disconnect cleanup to `roomHandler.js`

- **`websocket/router.js`** (The Switchboard)
  - Parses inbound payloads
  - Uses message `type` routing (`join`, `public_key`, `leave`, `ciphertext`)
  - Dispatches to room handler functions
  - Handles invalid payloads safely

- **`websocket/roomHandler.js`** (The Broadcaster and State Manager)
  - Owns in-memory room state: `Map<roomId, Set<ws>>`
  - Enforces room existence and membership on every action (join, public_key, ciphertext)
  - Authorization model matches REST: `Room.isUserInRoom` is checked per operation
  - Performs room-level fan-out to connected peers
  - Bootstraps peer public keys for joiners

- **`websocket/queue.js`** (Offline Storage)
  - Owns message persistence operation
  - Inserts ciphertext records into `messages` table

This separation keeps connection concerns, message routing, in-memory realtime state, and persistence responsibilities isolated and easier to evolve independently.

## Directory Layout

```text
backend/
  src/
    server.js                 # Entry point: HTTP server + WebSocket attach + listen
    app.js                    # Express app wiring (middleware + router mounts)
    db.js                     # SQLite initialization + schema bootstrap
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
      queue.js
  data/
    messages.db               # SQLite file created at runtime
  package.json
```

## Data Model

SQLite schema is initialized in `src/db.js` with WAL journal mode enabled:

- `users(id, username, public_key, public_key_hash)`
- `rooms(id, code)`
- `messages(id, room_id, sender_id, ciphertext, timestamp)`
- `user_rooms(user_id, room_id, joined_at, PRIMARY KEY(user_id, room_id))`
- `key_log(id AUTOINCREMENT, user_id, public_key, published_at)` — append-only key transparency log

Schema setup runs on import, so importing `db.js` ensures bootstrap is executed exactly once per process.

## HTTP API Surface

- `GET /healthz` — health check (no auth)
- `POST /auth/register` — create account (no auth)
- `POST /auth/login` — get token (no auth)
- `POST /rooms` — create room (auth)
- `GET /rooms/:code` — join room by invite code (auth)
- `GET /rooms/:roomId/messages` — get room messages (auth + membership)
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
- `leave` — leave a room
- `ciphertext` — send encrypted message

Outbound server message patterns include:

- `auth_ok` — authentication succeeded
- `joined` — room join confirmed
- `left` — room leave confirmed
- `public_key` — peer's public key
- `ciphertext` — relayed encrypted message
- `delivered` — message persistence confirmed
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
- `JWT_SECRET` (default `dev_secret_for_demo_only`)
- `DB_PATH` (default `./data/messages.db`, use `:memory:` for tests)

For production-like deployments, always set a strong `JWT_SECRET`.

## Operational Notes

- Database access is synchronous (`better-sqlite3`) by design. WAL journal mode is enabled for better read concurrency.
- Service/controller functions are `async` for uniformity across layers and future async extensibility.
- HTTP rate limiting is enabled globally at app level (200 req / 15 min per IP).
- WebSocket rate limiting is per-connection (20 messages/second). Payload size capped at 64KB.
- WebSocket authorization mirrors REST: room existence and membership are checked on every action.
- This backend stores ciphertext and metadata, not plaintext.
- Centralized error middleware catches all errors and returns consistent `{ error }` JSON envelopes.
- Graceful shutdown on SIGTERM/SIGINT: drains WebSocket connections, closes HTTP server, closes database.
- Docker healthcheck polls `GET /healthz`; the frontend container waits for `service_healthy`.

## Future work

- Add metrics endpoint for operations visibility.
- Merkle tree commitments over the key transparency log.
