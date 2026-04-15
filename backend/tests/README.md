# Backend Tests

Integration tests for the HTTP API using Vitest + supertest.

## Running

```bash
cd backend
npm test
```

## Coverage

- **Auth:** register, login, duplicate username rejection (409), missing username (400), unknown user (404)
- **Key publishing:** unauthenticated (401), wrong user (403), valid publish (200), key retrieval
- **Rooms:** unauthenticated creation (401), create, join by code, invalid code (404)
- **Room authorization:** member reads messages (200), non-member rejected (403)
- **User rooms:** unauthenticated listing (401), cross-user access (403), list own rooms, leave room
