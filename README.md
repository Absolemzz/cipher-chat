# Cipher-Chat

A demo application exploring end-to-end encrypted messaging architecture. Built to understand how client-side encryption, WebSockets, and secure message relay work together.

> **Note:** This is a demo — currently simulates multiple users on the same local instance.

## Architecture
```
React + TypeScript → WebSocket → Node.js relay → SQLite (ciphertext only)
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React, TypeScript |
| Backend | Node.js |
| Database | SQLite |
| Infra | Docker |

## Security Design

- Client-side AES-GCM encryption — server never sees plaintext
- Server stores ciphertext only
- Client-side key generation and encryption
- Demo mode uses a shared secret — production design targets ECDH key exchange

## Quick Start

Requires Docker:
```bash
docker-compose up --build
# Open http://localhost:3000
```

## Repository Structure

- `/frontend` - React + TypeScript client
- `/backend` - Node.js WebSocket relay
- `/crypto-spec` - Encryption design and specs
- `/infra` - Docker and infrastructure config

## License

MIT
