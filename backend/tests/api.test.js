import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { generateKeyPairSync, sign as cryptoSign } from 'crypto';

process.env.DB_PATH = ':memory:';
process.env.JWT_SECRET = 'test_jwt_secret';

const { default: app } = await import('../src/app.js');

let userA = {};
let userB = {};
let roomId = '';
let roomCode = '';
const DEFAULT_PASSWORD = 'correct horse battery staple';

function createAuthKeyPair() {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  return {
    privateKey,
    authPublicKey: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
  };
}

function signChallenge(privateKey, challenge) {
  return cryptoSign(
    'sha256',
    Buffer.from(challenge, 'utf8'),
    { key: privateKey, dsaEncoding: 'ieee-p1363' }
  ).toString('base64');
}

async function signedRegister(username, options = {}) {
  const auth = createAuthKeyPair();
  const password = options.password || DEFAULT_PASSWORD;
  const challenge = await request(app)
    .post('/auth/challenge')
    .send({ username, purpose: 'register', authPublicKey: auth.authPublicKey });
  const signature = signChallenge(auth.privateKey, challenge.body.challenge);
  const res = await request(app)
    .post('/auth/register')
    .send({
      username,
      password,
      authPublicKey: auth.authPublicKey,
      challengeId: challenge.body.challengeId,
      signature,
      ...options,
    });
  return { res, auth, password };
}

async function signedLogin(user, password = user.password) {
  const challenge = await request(app)
    .post('/auth/challenge')
    .send({ username: user.username, purpose: 'login' });
  const signature = signChallenge(user.auth.privateKey, challenge.body.challenge);
  return request(app)
    .post('/auth/login')
    .send({
      username: user.username,
      password,
      challengeId: challenge.body.challengeId,
      signature,
    });
}

describe('health', () => {
  it('returns ok', async () => {
    const res = await request(app).get('/healthz');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body).toHaveProperty('timestamp');
  });
});

describe('auth', () => {
  it('registers a new user', async () => {
    const { res, auth, password } = await signedRegister('alice');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('id');
    expect(res.body).toHaveProperty('token');
    expect(res.body.username).toBe('alice');
    userA = { ...res.body, auth, password };
  });

  it('rejects duplicate username', async () => {
    const res = await request(app)
      .post('/auth/challenge')
      .send({ username: 'alice', purpose: 'register', authPublicKey: createAuthKeyPair().authPublicKey });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already taken/i);
  });

  it('rejects empty username', async () => {
    const res = await request(app)
      .post('/auth/register')
      .send({});

    expect(res.status).toBe(400);
  });

  it('logs in an existing user', async () => {
    const res = await signedLogin(userA);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(userA.id);
    expect(res.body).toHaveProperty('token');
  });

  it('rejects login with the wrong password', async () => {
    const res = await signedLogin(userA, 'wrong horse battery staple');

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/invalid username or password/i);
  });

  it('rejects bare username login', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ username: 'alice' });

    expect(res.status).toBe(400);
  });

  it('rejects login signed by the wrong key', async () => {
    const challenge = await request(app)
      .post('/auth/challenge')
      .send({ username: userA.username, purpose: 'login' });
    const attacker = createAuthKeyPair();
    const res = await request(app)
      .post('/auth/login')
      .send({
        username: userA.username,
        password: userA.password,
        challengeId: challenge.body.challengeId,
        signature: signChallenge(attacker.privateKey, challenge.body.challenge),
      });

    expect(res.status).toBe(401);
  });

  it('rejects login for unknown user', async () => {
    const res = await request(app)
      .post('/auth/challenge')
      .send({ username: 'nonexistent', purpose: 'login' });

    expect(res.status).toBe(404);
  });

  it('registers a second user', async () => {
    const { res, auth, password } = await signedRegister('bob');

    expect(res.status).toBe(200);
    userB = { ...res.body, auth, password };
  });
});

describe('key publishing', () => {
  it('rejects unauthenticated publish', async () => {
    const res = await request(app)
      .post('/keys/publish')
      .send({ userId: userA.id, publicKey: 'test-key' });

    expect(res.status).toBe(401);
  });

  it('rejects publishing for another user', async () => {
    const res = await request(app)
      .post('/keys/publish')
      .set('Authorization', `Bearer ${userA.token}`)
      .send({ userId: userB.id, publicKey: 'test-key' });

    expect(res.status).toBe(403);
  });

  it('publishes key for own user', async () => {
    const res = await request(app)
      .post('/keys/publish')
      .set('Authorization', `Bearer ${userA.token}`)
      .send({ userId: userA.id, publicKey: 'alice-pub-key' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('published key is retrievable', async () => {
    const res = await request(app)
      .get(`/users/${userA.id}/public-key`);

    expect(res.status).toBe(200);
    expect(res.body.publicKey).toBe('alice-pub-key');
  });
});

describe('rooms', () => {
  it('rejects unauthenticated room creation', async () => {
    const res = await request(app).post('/rooms');

    expect(res.status).toBe(401);
  });

  it('creates a room', async () => {
    const res = await request(app)
      .post('/rooms')
      .set('Authorization', `Bearer ${userA.token}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('id');
    expect(res.body).toHaveProperty('code');
    roomId = res.body.id;
    roomCode = res.body.code;
  });

  it('joins a room by code', async () => {
    const res = await request(app)
      .get(`/rooms/${roomCode}`)
      .set('Authorization', `Bearer ${userB.token}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(roomId);
  });

  it('returns 404 for invalid room code', async () => {
    const res = await request(app)
      .get('/rooms/nonexistent')
      .set('Authorization', `Bearer ${userA.token}`);

    expect(res.status).toBe(404);
  });
});

describe('room authorization', () => {
  it('member can read messages', async () => {
    const res = await request(app)
      .get(`/rooms/${roomId}/messages`)
      .set('Authorization', `Bearer ${userA.token}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('non-member cannot read messages', async () => {
    const { res: reg } = await signedRegister('eve');

    const res = await request(app)
      .get(`/rooms/${roomId}/messages`)
      .set('Authorization', `Bearer ${reg.body.token}`);

    expect(res.status).toBe(403);
  });
});

describe('key transparency log', () => {
  it('returns log with entry after key publish', async () => {
    const res = await request(app)
      .get(`/keys/${userA.id}/log`)
      .set('Authorization', `Bearer ${userA.token}`);

    expect(res.status).toBe(200);
    expect(res.body.userId).toBe(userA.id);
    expect(res.body.entries.length).toBe(1);
    expect(res.body.entries[0].public_key).toBe('alice-pub-key');
    expect(res.body.entries[0]).toHaveProperty('published_at');
  });

  it('appends new entry on key rotation', async () => {
    await request(app)
      .post('/keys/publish')
      .set('Authorization', `Bearer ${userA.token}`)
      .send({ userId: userA.id, publicKey: 'alice-pub-key-v2' });

    const res = await request(app)
      .get(`/keys/${userA.id}/log`)
      .set('Authorization', `Bearer ${userA.token}`);

    expect(res.body.entries.length).toBe(2);
    expect(res.body.entries[0].public_key).toBe('alice-pub-key');
    expect(res.body.entries[1].public_key).toBe('alice-pub-key-v2');
  });

  it('returns empty log for user with no published key', async () => {
    const { res: reg } = await signedRegister('logtest');

    const res = await request(app)
      .get(`/keys/${reg.body.id}/log`)
      .set('Authorization', `Bearer ${reg.body.token}`);

    expect(res.status).toBe(200);
    expect(res.body.entries).toEqual([]);
  });

  it('rejects unauthenticated log request', async () => {
    const res = await request(app).get(`/keys/${userA.id}/log`);
    expect(res.status).toBe(401);
  });
});

describe('input validation', () => {
  it('rejects register with empty body', async () => {
    const res = await request(app)
      .post('/auth/register')
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('validation error');
    expect(res.body.details).toBeDefined();
  });

  it('rejects login with empty body', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('validation error');
  });

  it('rejects key publish with missing publicKey', async () => {
    const res = await request(app)
      .post('/keys/publish')
      .set('Authorization', `Bearer ${userA.token}`)
      .send({ userId: userA.id });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('validation error');
  });

  it('rejects key log with non-uuid userId', async () => {
    const res = await request(app)
      .get('/keys/not-a-uuid/log')
      .set('Authorization', `Bearer ${userA.token}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('validation error');
  });

  it('rejects public-key endpoint with non-uuid', async () => {
    const res = await request(app)
      .get('/users/not-a-uuid/public-key');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('validation error');
  });

  it('rejects room messages with non-uuid roomId', async () => {
    const res = await request(app)
      .get('/rooms/not-a-uuid/messages')
      .set('Authorization', `Bearer ${userA.token}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('validation error');
  });
});

describe('user rooms', () => {
  it('rejects unauthenticated room listing', async () => {
    const res = await request(app)
      .get(`/users/${userA.id}/rooms`);

    expect(res.status).toBe(401);
  });

  it('rejects accessing another user\'s rooms', async () => {
    const res = await request(app)
      .get(`/users/${userA.id}/rooms`)
      .set('Authorization', `Bearer ${userB.token}`);

    expect(res.status).toBe(403);
  });

  it('lists own rooms', async () => {
    const res = await request(app)
      .get(`/users/${userA.id}/rooms`)
      .set('Authorization', `Bearer ${userA.token}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body[0]).toHaveProperty('code');
  });

  it('can leave a room', async () => {
    const res = await request(app)
      .delete(`/users/${userB.id}/rooms/${roomId}`)
      .set('Authorization', `Bearer ${userB.token}`);

    expect(res.status).toBe(200);
    const inRoom = res.body.some((r) => r.id === roomId);
    expect(inRoom).toBe(false);
  });
});
