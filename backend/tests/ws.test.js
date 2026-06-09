import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import WebSocket from 'ws';
import request from 'supertest';
import { generateKeyPairSync, sign as cryptoSign } from 'crypto';
import { createRequire } from 'module';

process.env.DB_PATH = ':memory:';
process.env.JWT_SECRET = 'test_jwt_secret';

const { default: app } = await import('../src/app.js');
const attachWebSocket = (await import('../src/websocket/server.js')).default;
const require = createRequire(import.meta.url);

let server;
let wss;
let port;
let userA = {};
let userB = {};
let eve = {};
let roomId = '';
const DEFAULT_PASSWORD = 'correct horse battery staple';

function createAuthKeyPair() {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  return {
    privateKey,
    authPublicKey: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
  };
}

function signChallenge(privateKey, challenge) {
  return cryptoSign('sha256', Buffer.from(challenge, 'utf8'), {
    key: privateKey,
    dsaEncoding: 'ieee-p1363',
  }).toString('base64');
}

async function signedRegister(username) {
  const auth = createAuthKeyPair();
  const challenge = await request(app)
    .post('/auth/challenge')
    .send({ username, purpose: 'register', authPublicKey: auth.authPublicKey });
  const signature = signChallenge(auth.privateKey, challenge.body.challenge);
  const res = await request(app).post('/auth/register').send({
    username,
    password: DEFAULT_PASSWORD,
    authPublicKey: auth.authPublicKey,
    challengeId: challenge.body.challengeId,
    signature,
  });
  return { ...res.body, auth, password: DEFAULT_PASSWORD };
}

function wsUrl() {
  return `ws://127.0.0.1:${port}`;
}

function connectAndAuth(token) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl());
    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'auth', token }));
    });
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw);
      if (msg.type === 'auth_ok') resolve(ws);
      else if (msg.type === 'error') reject(new Error(msg.message));
    });
    ws.on('error', reject);
  });
}

function waitForMessage(ws, predicate, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout waiting for message')), timeoutMs);
    const handler = (raw) => {
      const msg = JSON.parse(raw);
      if (predicate(msg)) {
        clearTimeout(timer);
        ws.off('message', handler);
        resolve(msg);
      }
    };
    ws.on('message', handler);
  });
}

function waitForNoMessage(ws, predicate, timeoutMs = 150) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off('message', handler);
      resolve();
    }, timeoutMs);
    const handler = (raw) => {
      const msg = JSON.parse(raw);
      if (predicate(msg)) {
        clearTimeout(timer);
        ws.off('message', handler);
        reject(new Error('unexpected matching message'));
      }
    };
    ws.on('message', handler);
  });
}

beforeAll(async () => {
  server = http.createServer(app);
  wss = attachWebSocket(server);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;

  const req = request(app);

  userA = await signedRegister('ws_alice');

  userB = await signedRegister('ws_bob');

  eve = await signedRegister('ws_eve');

  const roomRes = await req.post('/rooms').set('Authorization', `Bearer ${userA.token}`);
  roomId = roomRes.body.id;
  const roomCode = roomRes.body.code;

  await req.get(`/rooms/${roomCode}`).set('Authorization', `Bearer ${userB.token}`);
});

afterAll(() => {
  wss.clients.forEach((ws) => {
    try {
      ws.close();
    } catch (_) {}
  });
  server.close();
});

describe('WebSocket auth', () => {
  it('rejects connection without auth message', async () => {
    const ws = new WebSocket(wsUrl());
    await new Promise((resolve) => ws.on('open', resolve));

    ws.send(JSON.stringify({ type: 'join', roomId }));
    const msg = await waitForMessage(ws, (m) => m.type === 'error');
    expect(msg.message).toMatch(/first message must be/);

    await new Promise((resolve) => ws.on('close', resolve));
  });

  it('rejects invalid token', async () => {
    const ws = new WebSocket(wsUrl());
    await new Promise((resolve) => ws.on('open', resolve));

    ws.send(JSON.stringify({ type: 'auth', token: 'garbage' }));
    const msg = await waitForMessage(ws, (m) => m.type === 'error');
    expect(msg.message).toMatch(/invalid or expired/);

    await new Promise((resolve) => ws.on('close', resolve));
  });

  it('accepts valid token', async () => {
    const ws = await connectAndAuth(userA.token);
    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
  });
});

describe('WebSocket room authorization', () => {
  it('member can join a room', async () => {
    const ws = await connectAndAuth(userA.token);

    ws.send(JSON.stringify({ type: 'join', roomId }));
    const msg = await waitForMessage(ws, (m) => m.type === 'joined');
    expect(msg.roomId).toBe(roomId);

    ws.close();
  });

  it('non-member cannot join a room', async () => {
    const ws = await connectAndAuth(eve.token);

    ws.send(JSON.stringify({ type: 'join', roomId }));
    const msg = await waitForMessage(ws, (m) => m.type === 'error');
    expect(msg.message).toMatch(/not a member/);

    ws.close();
  });

  it('rejects joining a room whose member list exceeds the two-party cap', async () => {
    const req = request(app);
    const Room = require('../src/models/Room');
    const roomRes = await req.post('/rooms').set('Authorization', `Bearer ${userA.token}`);
    const fullRoomId = roomRes.body.id;
    const fullRoomCode = roomRes.body.code;
    await req.get(`/rooms/${fullRoomCode}`).set('Authorization', `Bearer ${userB.token}`);
    Room.addUserToRoom(eve.id, fullRoomId, Date.now());

    const ws = await connectAndAuth(eve.token);

    ws.send(JSON.stringify({ type: 'join', roomId: fullRoomId }));
    const msg = await waitForMessage(ws, (m) => m.type === 'error');
    expect(msg.message).toMatch(/room is full/i);

    ws.close();
  });

  it('rejects join for nonexistent room', async () => {
    const ws = await connectAndAuth(userA.token);

    ws.send(JSON.stringify({ type: 'join', roomId: '00000000-0000-0000-0000-000000000000' }));
    const msg = await waitForMessage(ws, (m) => m.type === 'error');
    expect(msg.message).toMatch(/does not exist/);

    ws.close();
  });
});

describe('WebSocket ciphertext authorization', () => {
  it('accepts member ciphertext without persisting it server-side', async () => {
    const db = require('../src/db');
    const ws = await connectAndAuth(userA.token);

    ws.send(JSON.stringify({ type: 'join', roomId }));
    await waitForMessage(ws, (m) => m.type === 'joined');

    ws.send(
      JSON.stringify({
        type: 'ciphertext',
        roomId,
        ciphertext: '{"mode":"double-ratchet","dh":"test","pn":0,"n":0,"iv":"aa","ct":"bb"}',
        timestamp: Date.now(),
      }),
    );

    const msg = await waitForMessage(ws, (m) => m.type === 'message.accepted');
    expect(msg.roomId).toBe(roomId);
    await expect(
      waitForNoMessage(ws, (m) => m.type === 'message.delivered'),
    ).resolves.toBeUndefined();

    // The server is a pure relay: it must keep no server-side ciphertext store.
    const messageTable = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'messages'")
      .get();
    expect(messageTable).toBeUndefined();

    ws.close();
  });

  it('non-member cannot send ciphertext even after WS connect', async () => {
    const ws = await connectAndAuth(eve.token);

    ws.send(
      JSON.stringify({
        type: 'ciphertext',
        roomId,
        ciphertext: 'attack payload',
        timestamp: Date.now(),
      }),
    );

    const msg = await waitForMessage(ws, (m) => m.type === 'error');
    expect(msg.message).toMatch(/join room first|not a member/);

    ws.close();
  });
});

describe('WebSocket message relay', () => {
  it('ciphertext is relayed to other room members', async () => {
    const wsA = await connectAndAuth(userA.token);
    const wsB = await connectAndAuth(userB.token);

    wsA.send(JSON.stringify({ type: 'join', roomId }));
    await waitForMessage(wsA, (m) => m.type === 'joined');

    wsB.send(JSON.stringify({ type: 'join', roomId }));
    await waitForMessage(wsB, (m) => m.type === 'joined');

    const payload = '{"mode":"double-ratchet","dh":"x","pn":0,"n":0,"iv":"iv","ct":"ct"}';
    wsA.send(
      JSON.stringify({
        type: 'ciphertext',
        roomId,
        ciphertext: payload,
        timestamp: Date.now(),
      }),
    );

    const relayed = await waitForMessage(wsB, (m) => m.type === 'ciphertext');
    expect(relayed.ciphertext).toBe(payload);
    expect(relayed.from).toBe(userA.id);

    wsA.close();
    wsB.close();
  });

  it('relays ciphertext to members viewing a different room', async () => {
    const req = request(app);
    const roomTwoRes = await req.post('/rooms').set('Authorization', `Bearer ${userA.token}`);
    const roomTwoId = roomTwoRes.body.id;
    await req.get(`/rooms/${roomTwoRes.body.code}`).set('Authorization', `Bearer ${userB.token}`);

    const wsA = await connectAndAuth(userA.token);
    const wsB = await connectAndAuth(userB.token);

    wsA.send(JSON.stringify({ type: 'join', roomId }));
    await waitForMessage(wsA, (m) => m.type === 'joined');

    wsB.send(JSON.stringify({ type: 'join', roomId: roomTwoId }));
    await waitForMessage(wsB, (m) => m.type === 'joined');

    const payload = '{"mode":"double-ratchet","dh":"cross-room","pn":0,"n":0,"iv":"iv","ct":"ct"}';
    wsA.send(
      JSON.stringify({
        type: 'ciphertext',
        roomId,
        ciphertext: payload,
        timestamp: Date.now(),
      }),
    );

    const relayed = await waitForMessage(wsB, (m) => m.type === 'ciphertext');
    expect(relayed.ciphertext).toBe(payload);
    expect(relayed.roomId).toBe(roomId);
    expect(relayed.from).toBe(userA.id);

    wsA.close();
    wsB.close();
  });

  it('relays ciphertext to every open connection of a member', async () => {
    const wsA = await connectAndAuth(userA.token);
    const wsB1 = await connectAndAuth(userB.token);
    const wsB2 = await connectAndAuth(userB.token);

    wsA.send(JSON.stringify({ type: 'join', roomId }));
    await waitForMessage(wsA, (m) => m.type === 'joined');

    // Relay is membership-driven, so both of B's connections receive the message
    // even without an explicit join. Clients must serialize their shared ratchet.
    const payload = '{"mode":"double-ratchet","dh":"multi","pn":0,"n":0,"iv":"iv","ct":"ct"}';
    wsA.send(
      JSON.stringify({
        type: 'ciphertext',
        roomId,
        ciphertext: payload,
        timestamp: Date.now(),
      }),
    );

    const [relayedB1, relayedB2] = await Promise.all([
      waitForMessage(wsB1, (m) => m.type === 'ciphertext'),
      waitForMessage(wsB2, (m) => m.type === 'ciphertext'),
    ]);
    expect(relayedB1.ciphertext).toBe(payload);
    expect(relayedB2.ciphertext).toBe(payload);

    wsA.close();
    wsB1.close();
    wsB2.close();
  });

  it('forwards recipient delivery acknowledgements to the original sender', async () => {
    const wsA = await connectAndAuth(userA.token);
    const wsB = await connectAndAuth(userB.token);

    wsA.send(JSON.stringify({ type: 'join', roomId }));
    await waitForMessage(wsA, (m) => m.type === 'joined');

    wsB.send(JSON.stringify({ type: 'join', roomId }));
    await waitForMessage(wsB, (m) => m.type === 'joined');

    const clientMessageId = 'recipient-delivery-1';
    wsA.send(
      JSON.stringify({
        type: 'ciphertext',
        id: clientMessageId,
        clientMessageId,
        roomId,
        ciphertext: '{"mode":"double-ratchet","dh":"x","pn":0,"n":0,"iv":"iv","ct":"ct"}',
        timestamp: Date.now(),
      }),
    );

    await waitForMessage(
      wsB,
      (m) => m.type === 'ciphertext' && m.clientMessageId === clientMessageId,
    );
    await waitForMessage(
      wsA,
      (m) => m.type === 'message.accepted' && m.clientMessageId === clientMessageId,
    );

    const deliveredPromise = waitForMessage(
      wsA,
      (m) => m.type === 'message.delivered' && m.clientMessageId === clientMessageId,
    );
    wsB.send(
      JSON.stringify({
        type: 'message.delivered',
        roomId,
        clientMessageId,
      }),
    );

    expect(await deliveredPromise).toMatchObject({
      type: 'message.delivered',
      id: clientMessageId,
      clientMessageId,
      roomId,
    });

    wsA.close();
    wsB.close();
  });

  it('acks duplicate client message ids without relaying duplicate ciphertext', async () => {
    const wsA = await connectAndAuth(userA.token);
    const wsB = await connectAndAuth(userB.token);

    wsA.send(JSON.stringify({ type: 'join', roomId }));
    await waitForMessage(wsA, (m) => m.type === 'joined');

    wsB.send(JSON.stringify({ type: 'join', roomId }));
    await waitForMessage(wsB, (m) => m.type === 'joined');

    const clientMessageId = 'client-message-1';
    const payload = '{"mode":"double-ratchet","dh":"x","pn":0,"n":0,"iv":"iv","ct":"ct"}';
    const relayPromise = waitForMessage(
      wsB,
      (m) => m.type === 'ciphertext' && m.clientMessageId === clientMessageId,
    );
    const firstAckPromise = waitForMessage(
      wsA,
      (m) => m.type === 'message.accepted' && m.clientMessageId === clientMessageId,
    );

    wsA.send(
      JSON.stringify({
        type: 'ciphertext',
        id: clientMessageId,
        clientMessageId,
        roomId,
        ciphertext: payload,
        timestamp: Date.now(),
      }),
    );

    const relayed = await relayPromise;
    expect(relayed.ciphertext).toBe(payload);
    expect(relayed.id).toBe(clientMessageId);
    expect(await firstAckPromise).toMatchObject({
      type: 'message.accepted',
      id: clientMessageId,
      clientMessageId,
      roomId,
    });

    const secondAckPromise = waitForMessage(
      wsA,
      (m) => m.type === 'message.accepted' && m.clientMessageId === clientMessageId,
    );
    wsA.send(
      JSON.stringify({
        type: 'ciphertext',
        id: clientMessageId,
        clientMessageId,
        roomId,
        ciphertext: payload,
        timestamp: Date.now(),
      }),
    );

    expect(await secondAckPromise).toMatchObject({
      type: 'message.accepted',
      id: clientMessageId,
      clientMessageId,
      roomId,
    });
    await expect(
      waitForNoMessage(
        wsA,
        (m) => m.type === 'message.delivered' && m.clientMessageId === clientMessageId,
      ),
    ).resolves.toBeUndefined();
    await expect(
      waitForNoMessage(
        wsB,
        (m) => m.type === 'ciphertext' && m.clientMessageId === clientMessageId,
      ),
    ).resolves.toBeUndefined();

    wsA.close();
    wsB.close();
  });

  it('does not dedupe distinct messages from different senders with the same client message id', async () => {
    const wsA = await connectAndAuth(userA.token);
    const wsB = await connectAndAuth(userB.token);

    wsA.send(JSON.stringify({ type: 'join', roomId }));
    await waitForMessage(wsA, (m) => m.type === 'joined');

    wsB.send(JSON.stringify({ type: 'join', roomId }));
    await waitForMessage(wsB, (m) => m.type === 'joined');

    const clientMessageId = 'same-id-different-senders';
    wsA.send(
      JSON.stringify({
        type: 'ciphertext',
        id: clientMessageId,
        clientMessageId,
        roomId,
        ciphertext: 'from-user-a',
        timestamp: Date.now(),
      }),
    );
    const relayedToB = await waitForMessage(
      wsB,
      (m) => m.type === 'ciphertext' && m.clientMessageId === clientMessageId,
    );
    expect(relayedToB.ciphertext).toBe('from-user-a');

    wsB.send(
      JSON.stringify({
        type: 'ciphertext',
        id: clientMessageId,
        clientMessageId,
        roomId,
        ciphertext: 'from-user-b',
        timestamp: Date.now(),
      }),
    );
    const relayedToA = await waitForMessage(
      wsA,
      (m) => m.type === 'ciphertext' && m.clientMessageId === clientMessageId,
    );
    expect(relayedToA.ciphertext).toBe('from-user-b');

    wsA.close();
    wsB.close();
  });

  it('does not dedupe distinct messages in different rooms with the same client message id', async () => {
    const req = request(app);
    const roomRes = await req.post('/rooms').set('Authorization', `Bearer ${userA.token}`);
    const secondRoomId = roomRes.body.id;
    const secondRoomCode = roomRes.body.code;
    await req.get(`/rooms/${secondRoomCode}`).set('Authorization', `Bearer ${userB.token}`);

    const wsA1 = await connectAndAuth(userA.token);
    const wsB1 = await connectAndAuth(userB.token);
    const wsA2 = await connectAndAuth(userA.token);
    const wsB2 = await connectAndAuth(userB.token);

    wsA1.send(JSON.stringify({ type: 'join', roomId }));
    await waitForMessage(wsA1, (m) => m.type === 'joined');
    wsB1.send(JSON.stringify({ type: 'join', roomId }));
    await waitForMessage(wsB1, (m) => m.type === 'joined');

    wsA2.send(JSON.stringify({ type: 'join', roomId: secondRoomId }));
    await waitForMessage(wsA2, (m) => m.type === 'joined');
    wsB2.send(JSON.stringify({ type: 'join', roomId: secondRoomId }));
    await waitForMessage(wsB2, (m) => m.type === 'joined');

    const clientMessageId = 'same-id-different-rooms';
    wsA1.send(
      JSON.stringify({
        type: 'ciphertext',
        id: clientMessageId,
        clientMessageId,
        roomId,
        ciphertext: 'room-one-message',
        timestamp: Date.now(),
      }),
    );
    const relayedRoomOne = await waitForMessage(
      wsB1,
      (m) => m.type === 'ciphertext' && m.clientMessageId === clientMessageId,
    );
    expect(relayedRoomOne.ciphertext).toBe('room-one-message');

    wsA2.send(
      JSON.stringify({
        type: 'ciphertext',
        id: clientMessageId,
        clientMessageId,
        roomId: secondRoomId,
        ciphertext: 'room-two-message',
        timestamp: Date.now(),
      }),
    );
    const relayedRoomTwo = await waitForMessage(
      wsB2,
      (m) =>
        m.type === 'ciphertext' &&
        m.clientMessageId === clientMessageId &&
        m.roomId === secondRoomId,
    );
    expect(relayedRoomTwo.ciphertext).toBe('room-two-message');

    wsA1.close();
    wsB1.close();
    wsA2.close();
    wsB2.close();
  });
});

describe('WebSocket observability', () => {
  it('exports WebSocket metrics', async () => {
    const res = await request(app).get('/metrics');

    expect(res.status).toBe(200);
    expect(res.text).toContain('cipher_chat_ws_active_connections');
    expect(res.text).toContain('cipher_chat_ws_messages_total');
    expect(res.text).toContain('cipher_chat_ws_errors_total');
    expect(res.text).toMatch(/cipher_chat_ws_messages_total\{direction="received",type="auth"\}/);
  });
});
