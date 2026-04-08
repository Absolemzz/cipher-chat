# Cipher chat Backend

Backend service for Cipher chat, an end-to-end encrypted chat application. This service is intentionally designed as a ciphertext relay and metadata coordinator: clients handle encryption/decryption, while the backend handles authentication, room membership, message persistence, and WebSocket fan-out.

## Overview

- Runtime: Node.js (CommonJS)
- API: Express HTTP server
- Realtime: WebSocket (`ws`)
- Persistence: SQLite (`better-sqlite3`)
- Auth: JWT bearer tokens
- Logging and hardening: `morgan`, CORS, rate limiting

## Architecture

The backend follows a layered architecture for HTTP features:

- **Route**: URL mapping only
- **Controller**: request/response orchestration and auth extraction
- **Service**: business logic and orchestration
- **Model**: direct database access (synchronous `better-sqlite3`)

### Layered Request Flow

1. Route receives request and forwards to controller.
2. Controller validates/authenticates request context and calls service.
3. Service executes business logic and calls model methods.
4. Model executes SQL synchronously and returns data.
5. Controller returns normalized HTTP response.

## WebSocket Modular Design

WebSocket handling is split into four focused modules:

- **`websocket/server.js`** (The Bouncer)
  - Creates `WebSocket.Server`
  - Handles connection lifecycle
  - Extracts JWT token from query string and validates with `authFromToken`
  - Rejects unauthorized connections
  - Delegates message payloads to `router.js`
  - Delegates disconnect cleanup to `roomHandler.js`

- **`websocket/router.js`** (The Switchboard)
  - Parses inbound payloads
  - Uses message `type` routing (`join`, `public_key`, `leave`, `ciphertext`)
  - Dispatches to room handler functions
  - Handles invalid payloads safely

- **`websocket/roomHandler.js`** (The Broadcaster and State Manager)
  - Owns in-memory room state: `Map<roomId, Set<ws>>`
  - Handles join/leave/public key/ciphertext behavior
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
      auth.js                 # JWT token verification helper
    routes/
      auth.js                 # /auth endpoints
      rooms.js                # /rooms endpoints
      users.js                # /users endpoints
      keys.js                 # /keys endpoints
    controllers/
      authController.js
      roomsController.js
    services/
      authService.js
      roomService.js
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

SQLite schema is initialized in `src/db.js`:

- `users(id, username, public_key, public_key_hash)`
- `rooms(id, code)`
- `messages(id, room_id, sender_id, ciphertext, timestamp)`
- `user_rooms(user_id, room_id, joined_at, PRIMARY KEY(user_id, room_id))`

Schema setup runs on import, so importing `db.js` ensures bootstrap is executed exactly once per process.

## HTTP API Surface

- `POST /auth/register`
- `POST /auth/login`
- `POST /rooms`
- `GET /rooms/:code`
- `GET /rooms/:roomId/messages`
- `GET /users/:userId/rooms`
- `DELETE /users/:userId/rooms/:roomId`
- `GET /users/:userId/public-key`
- `POST /keys/publish`

Most non-auth routes expect `Authorization: Bearer <token>`.

## WebSocket Message Types

Inbound message `type` values:

- `join`
- `public_key`
- `leave`
- `ciphertext`

Outbound server message patterns include:

- `joined`
- `left`
- `public_key`
- `ciphertext`
- `delivered`
- `error`

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

For production-like deployments, always set a strong `JWT_SECRET`.

## Operational Notes

- Database access is synchronous (`better-sqlite3`) by design.
- Service/controller functions are `async` for uniformity across layers and future async extensibility.
- Rate limiting is enabled globally at app level.
- This backend stores ciphertext and metadata, not plaintext.

## Future work

- Add request schema validation middleware for route inputs.
- Add centralized error middleware for consistent API error envelopes.
- Add integration tests for HTTP routes and WebSocket flows.
- Add metrics and health/readiness endpoints for operations visibility.
