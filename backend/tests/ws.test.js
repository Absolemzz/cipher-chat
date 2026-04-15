import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import WebSocket from 'ws';

process.env.DB_PATH = ':memory:';

const { default: app } = await import('../src/app.js');
const attachWebSocket = (await import('../src/websocket/server.js')).default;

let server;
let wss;
let port;
let userA = {};
let userB = {};
let eve = {};
let roomId = '';

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

beforeAll(async () => {
  server = http.createServer(app);
  wss = attachWebSocket(server);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;

  const supertest = (await import('supertest')).default;
  const req = supertest(app);

  const resA = await req.post('/auth/register').send({ username: 'ws_alice' });
  userA = resA.body;

  const resB = await req.post('/auth/register').send({ username: 'ws_bob' });
  userB = resB.body;

  const resEve = await req.post('/auth/register').send({ username: 'ws_eve' });
  eve = resEve.body;

  const roomRes = await req.post('/rooms').set('Authorization', `Bearer ${userA.token}`);
  roomId = roomRes.body.id;
  const roomCode = roomRes.body.code;

  await req.get(`/rooms/${roomCode}`).set('Authorization', `Bearer ${userB.token}`);
});

afterAll(() => {
  wss.clients.forEach((ws) => { try { ws.close(); } catch (_) {} });
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

  it('rejects join for nonexistent room', async () => {
    const ws = await connectAndAuth(userA.token);

    ws.send(JSON.stringify({ type: 'join', roomId: '00000000-0000-0000-0000-000000000000' }));
    const msg = await waitForMessage(ws, (m) => m.type === 'error');
    expect(msg.message).toMatch(/does not exist/);

    ws.close();
  });
});

describe('WebSocket ciphertext authorization', () => {
  it('member can send ciphertext', async () => {
    const ws = await connectAndAuth(userA.token);

    ws.send(JSON.stringify({ type: 'join', roomId }));
    await waitForMessage(ws, (m) => m.type === 'joined');

    ws.send(JSON.stringify({
      type: 'ciphertext',
      roomId,
      ciphertext: '{"mode":"double-ratchet","dh":"test","pn":0,"n":0,"iv":"aa","ct":"bb"}',
      timestamp: Date.now()
    }));

    const msg = await waitForMessage(ws, (m) => m.type === 'delivered');
    expect(msg.roomId).toBe(roomId);

    ws.close();
  });

  it('non-member cannot send ciphertext even after WS connect', async () => {
    const ws = await connectAndAuth(eve.token);

    ws.send(JSON.stringify({
      type: 'ciphertext',
      roomId,
      ciphertext: 'attack payload',
      timestamp: Date.now()
    }));

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
    wsA.send(JSON.stringify({
      type: 'ciphertext',
      roomId,
      ciphertext: payload,
      timestamp: Date.now()
    }));

    const relayed = await waitForMessage(wsB, (m) => m.type === 'ciphertext');
    expect(relayed.ciphertext).toBe(payload);
    expect(relayed.from).toBe(userA.id);

    wsA.close();
    wsB.close();
  });
});
