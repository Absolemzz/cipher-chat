// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ChatRoom from './ChatRoom';
import { apiFetch } from '../lib/transport';
import { LOCAL_CHAT_DB_NAME, readEncryptedRecordsForTest } from '../lib/localEncryptedStore';
import { ratchetEncrypt } from '../crypto/double-ratchet';

const uuidState = vi.hoisted(() => ({ count: 0 }));

vi.mock('../lib/transport', () => ({
  apiFetch: vi.fn(),
  getWebSocketUrl: vi.fn(() => 'ws://chat.test/ws'),
}));

vi.mock('../crypto/crypto', () => {
  const makeSession = () => ({
    dhSend: { pub: 'dh-pub', priv: 'dh-priv' },
    dhRecv: 'peer-public-key',
    rootKey: new Uint8Array([1, 2, 3]).buffer,
    chainKeySend: new Uint8Array([4, 5, 6]).buffer,
    chainKeyRecv: new Uint8Array([7, 8, 9]).buffer,
    sendN: 0,
    recvN: 0,
    prevSendN: 0,
    skippedKeys: new Map<string, ArrayBuffer>(),
    initialChain: true,
    pendingSendRatchet: false,
  });

  return {
    ensureKeys: vi.fn(async () => 'my-public-key'),
    getKeyFingerprint: vi.fn(async () => 'AA:BB:CC:DD:EE:FF:00:11'),
    getPublicKey: vi.fn(() => 'my-public-key'),
    initDoubleRatchet: vi.fn(async () => makeSession()),
  };
});

vi.mock('../crypto/double-ratchet', () => ({
  deserializeRatchetSession: vi.fn(() => ({
    dhSend: { pub: 'dh-pub', priv: 'dh-priv' },
    dhRecv: 'peer-public-key',
    rootKey: new Uint8Array([1, 2, 3]).buffer,
    chainKeySend: new Uint8Array([4, 5, 6]).buffer,
    chainKeyRecv: new Uint8Array([7, 8, 9]).buffer,
    sendN: 0,
    recvN: 0,
    prevSendN: 0,
    skippedKeys: new Map<string, ArrayBuffer>(),
    initialChain: true,
    pendingSendRatchet: false,
  })),
  ratchetDecrypt: vi.fn(async (session, ciphertext: string) => ({
    plaintext: `decrypted:${ciphertext}`,
    session,
  })),
  ratchetEncrypt: vi.fn(async (session, plaintext: string) => ({
    ciphertext: `encrypted:${plaintext}`,
    session,
  })),
  serializeRatchetSession: vi.fn(() => ({
    version: 1,
    dhSend: { pub: 'dh-pub', priv: 'dh-priv' },
    dhRecv: 'peer-public-key',
    rootKey: 'AQID',
    chainKeySend: 'BAUG',
    chainKeyRecv: 'BwgJ',
    sendN: 0,
    recvN: 0,
    prevSendN: 0,
    skippedKeys: [],
    initialChain: true,
    pendingSendRatchet: false,
  })),
}));

vi.mock('../crypto/safety-number', () => ({
  SAFETY_NUMBER_VERSION: 1,
  deriveSafetyNumber: vi.fn(async ({ peerIdentityPublicKey }) => ({
    version: 1,
    number: `10000 20000 30000 40000 50000 60000 70000 80000 90000 00001 00002 00003`,
    peerKeyFingerprint: `fingerprint:${peerIdentityPublicKey}`,
  })),
}));

vi.mock('uuid', () => ({
  v4: vi.fn(() => {
    uuidState.count += 1;
    return `message-id-${uuidState.count}`;
  }),
}));

const user = { id: 'user-1', username: 'alice', token: 'token-1' };
const room = { id: 'room-1', code: 'ROOM1' };
const secondRoom = { id: 'room-2', code: 'ROOM2' };

class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  static instances: FakeWebSocket[] = [];

  listeners = new Map<string, Array<(event: { data: string }) => void>>();
  onopen: ((event: { data: string }) => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { data: string }) => void) | null = null;
  onerror: ((event: { data: string }) => void) | null = null;
  closeCalls = 0;
  readyState = FakeWebSocket.CONNECTING;
  sent: string[] = [];

  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type: string, listener: (event: { data: string }) => void) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  close() {
    this.closeCalls += 1;
    if (this.readyState === FakeWebSocket.CLOSED) return;
    this.readyState = FakeWebSocket.CLOSED;
    this.emitClose();
  }

  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.({ data: '' });
    for (const listener of this.listeners.get('open') ?? []) {
      listener({ data: '' });
    }
  }

  receive(payload: unknown) {
    this.onmessage?.({ data: JSON.stringify(payload) });
    for (const listener of this.listeners.get('message') ?? []) {
      listener({ data: JSON.stringify(payload) });
    }
  }

  emitClose() {
    this.onclose?.({ data: '' });
    for (const listener of this.listeners.get('close') ?? []) {
      listener({ data: '' });
    }
  }

  unexpectedClose() {
    this.readyState = FakeWebSocket.CLOSED;
    this.emitClose();
  }

  send(payload: string) {
    this.sent.push(payload);
  }
}

function lastSocket() {
  const socket = FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
  if (!socket) throw new Error('expected a WebSocket instance');
  return socket;
}

async function waitForSocket() {
  await waitFor(() => {
    expect(FakeWebSocket.instances.length).toBeGreaterThan(0);
  });
  return lastSocket();
}

async function waitForSocketCount(count: number) {
  await waitFor(() => {
    expect(FakeWebSocket.instances.length).toBeGreaterThanOrEqual(count);
  });
  return lastSocket();
}

async function deleteDb(name: string): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await tryDeleteDb(name);
      return;
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes('blocked') || attempt === 4) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
}

function tryDeleteDb(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('deleteDatabase blocked'));
  });
}

function sentMessages(socket: FakeWebSocket) {
  return socket.sent.map((payload) => JSON.parse(payload));
}

function sentCiphertexts(socket: FakeWebSocket) {
  return sentMessages(socket).filter((message) => message.type === 'ciphertext');
}

function completeHandshake(
  socket: FakeWebSocket,
  peerPublicKey = 'peer-public-key',
  joinedRoomId = 'room-1',
) {
  socket.open();
  socket.receive({ type: 'auth_ok', userId: 'user-1' });
  socket.receive({ type: 'joined', roomId: joinedRoomId });
  socket.receive({
    type: 'public_key',
    userId: 'peer-1',
    publicKey: peerPublicKey,
    roomId: joinedRoomId,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  uuidState.count = 0;
  FakeWebSocket.instances = [];
  vi.stubGlobal('WebSocket', FakeWebSocket);
  vi.stubGlobal('alert', vi.fn());
  vi.stubGlobal(
    'confirm',
    vi.fn(() => true),
  );
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  });
  vi.mocked(apiFetch).mockImplementation(async (path) => {
    if (path === '/users/user-1/rooms') {
      return new Response(JSON.stringify([room, secondRoom]), { status: 200 });
    }
    if (path === '/keys/peer-1/log') {
      return new Response(JSON.stringify({ entries: [] }), { status: 200 });
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  });
});

afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await deleteDb(LOCAL_CHAT_DB_NAME);
});

describe('ChatRoom integration', () => {
  it('authenticates and joins over WebSocket without fetching server history', async () => {
    render(<ChatRoom user={user} room={room} onLogout={vi.fn()} />);

    const socket = await waitForSocket();
    expect(socket.url).toBe('ws://chat.test/ws');

    socket.open();
    await waitFor(() => {
      expect(sentMessages(socket)).toContainEqual({ type: 'auth', token: 'token-1' });
    });

    socket.receive({ type: 'auth_ok', userId: 'user-1' });
    await waitFor(() => {
      expect(sentMessages(socket)).toContainEqual({ type: 'join', roomId: 'room-1' });
    });
    socket.receive({ type: 'joined', roomId: 'room-1' });

    expect(vi.mocked(apiFetch).mock.calls).not.toContainEqual([
      '/rooms/room-1/messages',
      expect.anything(),
    ]);
  });

  it('queues a pending message before the socket opens without encrypting or alerting', async () => {
    render(<ChatRoom user={user} room={room} onLogout={vi.fn()} />);

    const socket = await waitForSocket();

    expect(screen.getByText('Connecting to chat...')).toBeInTheDocument();
    const input = screen.getByPlaceholderText('Type a message...');
    await userEvent.type(input, 'queued early');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));

    expect(await screen.findByText('queued early')).toBeInTheDocument();
    expect(screen.getByText(/Waiting for connection/)).toBeInTheDocument();
    expect(ratchetEncrypt).not.toHaveBeenCalled();
    expect(sentCiphertexts(socket)).toEqual([]);
    expect(vi.mocked(window.alert)).not.toHaveBeenCalled();
  });

  it('establishes a live session, sends ciphertext, and marks delivery', async () => {
    render(<ChatRoom user={user} room={room} onLogout={vi.fn()} />);

    const socket = await waitForSocket();
    completeHandshake(socket);

    const input = await screen.findByPlaceholderText('Type a message...');
    await userEvent.type(input, 'hello');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => {
      expect(ratchetEncrypt).toHaveBeenCalledWith(expect.anything(), 'hello');
      expect(sentMessages(socket)).toContainEqual({
        type: 'ciphertext',
        id: 'message-id-1',
        clientMessageId: 'message-id-1',
        roomId: 'room-1',
        ciphertext: 'encrypted:hello',
        timestamp: expect.any(Number),
      });
    });
    expect(screen.getByText('hello')).toBeInTheDocument();
    expect(screen.getByText(/Sending/)).toBeInTheDocument();

    socket.receive({
      type: 'message.accepted',
      id: 'message-id-1',
      clientMessageId: 'message-id-1',
      roomId: 'room-1',
    });

    await waitFor(() => {
      expect(screen.getByText(/Sent/)).toBeInTheDocument();
    });
    expect(screen.queryByText(/Delivered/)).not.toBeInTheDocument();

    socket.receive({
      type: 'message.delivered',
      id: 'message-id-1',
      clientMessageId: 'message-id-1',
      roomId: 'room-1',
    });

    await waitFor(() => {
      expect(screen.getByText(/Delivered/)).toBeInTheDocument();
    });
  });

  it('keeps accepted messages sent until a recipient delivery ack arrives', async () => {
    render(<ChatRoom user={user} room={room} onLogout={vi.fn()} />);

    const socket = await waitForSocket();
    completeHandshake(socket);

    const input = await screen.findByPlaceholderText('Type a message...');
    await userEvent.type(input, 'accepted only');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => {
      expect(sentCiphertexts(socket)).toHaveLength(1);
    });
    socket.receive({
      type: 'message.accepted',
      id: 'message-id-1',
      clientMessageId: 'message-id-1',
      roomId: 'room-1',
    });
    socket.receive({
      type: 'message.accepted',
      id: 'message-id-1',
      clientMessageId: 'message-id-1',
      roomId: 'room-1',
    });

    expect(await screen.findByText(/Sent/)).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(screen.queryByText(/Delivered/)).not.toBeInTheDocument();
  });

  it('ignores recipient delivery acks for the wrong room or client message id', async () => {
    render(<ChatRoom user={user} room={room} onLogout={vi.fn()} />);

    const socket = await waitForSocket();
    completeHandshake(socket);

    const input = await screen.findByPlaceholderText('Type a message...');
    await userEvent.type(input, 'wrong ack ignored');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => {
      expect(sentCiphertexts(socket)).toHaveLength(1);
    });
    socket.receive({
      type: 'message.accepted',
      id: 'message-id-1',
      clientMessageId: 'message-id-1',
      roomId: 'room-1',
    });
    expect(await screen.findByText(/Sent/)).toBeInTheDocument();

    socket.receive({
      type: 'message.delivered',
      id: 'message-id-1',
      clientMessageId: 'message-id-1',
      roomId: 'room-2',
    });
    socket.receive({
      type: 'message.delivered',
      id: 'other-message-id',
      clientMessageId: 'other-message-id',
      roomId: 'room-1',
    });

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(screen.queryByText(/Delivered/)).not.toBeInTheDocument();
  });

  it('sends a recipient delivery ack only after decrypting an inbound message', async () => {
    render(<ChatRoom user={user} room={room} onLogout={vi.fn()} />);

    const socket = await waitForSocket();
    completeHandshake(socket);

    socket.receive({
      type: 'ciphertext',
      id: 'inbound-1',
      clientMessageId: 'inbound-1',
      roomId: 'room-1',
      from: 'peer-1',
      ciphertext: 'peer-ciphertext',
      timestamp: 200,
    });

    expect(await screen.findByText('decrypted:peer-ciphertext')).toBeInTheDocument();
    await waitFor(() => {
      expect(sentMessages(socket)).toContainEqual({
        type: 'message.delivered',
        roomId: 'room-1',
        clientMessageId: 'inbound-1',
      });
    });
  });

  it('queues during reconnect and sends on the current socket after rejoin', async () => {
    render(<ChatRoom user={user} room={room} onLogout={vi.fn()} />);

    const firstSocket = await waitForSocket();
    completeHandshake(firstSocket);
    expect(await screen.findByText('Secure session ready')).toBeInTheDocument();

    firstSocket.unexpectedClose();
    expect(await screen.findByText('Reconnecting to chat...')).toBeInTheDocument();

    const input = await screen.findByPlaceholderText('Type a message...');
    await userEvent.type(input, 'during reconnect');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText('during reconnect')).toBeInTheDocument();
    expect(screen.getByText(/Waiting for connection/)).toBeInTheDocument();
    expect(ratchetEncrypt).not.toHaveBeenCalledWith(expect.anything(), 'during reconnect');

    const secondSocket = await waitForSocketCount(2);
    secondSocket.open();
    await waitFor(() => {
      expect(sentMessages(secondSocket)).toContainEqual({ type: 'auth', token: 'token-1' });
    });
    secondSocket.receive({ type: 'auth_ok', userId: 'user-1' });
    await waitFor(() => {
      expect(sentMessages(secondSocket)).toContainEqual({ type: 'join', roomId: 'room-1' });
    });
    secondSocket.receive({ type: 'joined', roomId: 'room-1' });
    secondSocket.receive({
      type: 'public_key',
      userId: 'peer-1',
      publicKey: 'peer-public-key',
      roomId: 'room-1',
    });

    await waitFor(() => {
      expect(sentMessages(secondSocket)).toContainEqual({
        type: 'ciphertext',
        id: 'message-id-1',
        clientMessageId: 'message-id-1',
        roomId: 'room-1',
        ciphertext: 'encrypted:during reconnect',
        timestamp: expect.any(Number),
      });
    });
    expect(sentMessages(firstSocket)).not.toContainEqual(
      expect.objectContaining({ ciphertext: 'encrypted:during reconnect' }),
    );
    expect(vi.mocked(window.alert)).not.toHaveBeenCalled();
  });

  it('keeps a queued message pending when the socket closes before readiness', async () => {
    render(<ChatRoom user={user} room={room} onLogout={vi.fn()} />);

    const socket = await waitForSocket();
    const input = await screen.findByPlaceholderText('Type a message...');
    await userEvent.type(input, 'not ready yet');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));

    socket.unexpectedClose();

    expect(await screen.findByText('not ready yet')).toBeInTheDocument();
    expect(screen.getByText(/Waiting for connection/)).toBeInTheDocument();
    expect(ratchetEncrypt).not.toHaveBeenCalled();
    expect(sentCiphertexts(socket)).toEqual([]);
  });

  it('flushes a queued message after room readiness is restored', async () => {
    render(<ChatRoom user={user} room={room} onLogout={vi.fn()} />);

    const socket = await waitForSocket();
    const input = await screen.findByPlaceholderText('Type a message...');
    await userEvent.type(input, 'flush me');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));

    expect(await screen.findByText('flush me')).toBeInTheDocument();
    expect(ratchetEncrypt).not.toHaveBeenCalled();

    completeHandshake(socket);

    await waitFor(() => {
      expect(sentMessages(socket)).toContainEqual({
        type: 'ciphertext',
        id: 'message-id-1',
        clientMessageId: 'message-id-1',
        roomId: 'room-1',
        ciphertext: 'encrypted:flush me',
        timestamp: expect.any(Number),
      });
    });
    expect(ratchetEncrypt).toHaveBeenCalledWith(expect.anything(), 'flush me');
  });

  it('ignores stale close events after a newer socket is connected', async () => {
    render(<ChatRoom user={user} room={room} onLogout={vi.fn()} />);

    const firstSocket = await waitForSocket();
    completeHandshake(firstSocket);
    firstSocket.unexpectedClose();

    const secondSocket = await waitForSocketCount(2);
    completeHandshake(secondSocket);
    expect(await screen.findByText('Secure session ready')).toBeInTheDocument();

    firstSocket.emitClose();

    expect(screen.getByText('Secure session ready')).toBeInTheDocument();
    expect(screen.queryByText('Chat connection disconnected')).not.toBeInTheDocument();
  });

  it('shows unverified peer state and can mark the safety number as verified', async () => {
    render(<ChatRoom user={user} room={room} onLogout={vi.fn()} />);

    const socket = await waitForSocket();
    completeHandshake(socket);

    expect(await screen.findByText('Peer unverified')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'View safety number' }));
    expect(screen.getByRole('dialog', { name: 'Safety number' })).toBeInTheDocument();
    expect(screen.getByText(/10000 20000 30000/)).toBeInTheDocument();

    await userEvent.click(await screen.findByRole('button', { name: 'Mark as verified' }));

    expect(await screen.findByText('Peer verified')).toBeInTheDocument();
  });

  it('restores local transcript after remount and decrypts the next live message', async () => {
    const { unmount } = render(<ChatRoom user={user} room={room} onLogout={vi.fn()} />);

    const firstSocket = await waitForSocket();
    completeHandshake(firstSocket);

    const input = await screen.findByPlaceholderText('Type a message...');
    await userEvent.type(input, 'persist me');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => {
      expect(screen.getByText('persist me')).toBeInTheDocument();
    });
    await waitFor(async () => {
      expect(await readEncryptedRecordsForTest('user-1', 'room-1')).not.toEqual([]);
    });

    unmount();
    render(<ChatRoom user={user} room={room} onLogout={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('persist me')).toBeInTheDocument();
    });

    const secondSocket = await waitForSocketCount(2);
    completeHandshake(secondSocket);
    secondSocket.receive({
      type: 'ciphertext',
      id: 'inbound-1',
      from: 'peer-1',
      ciphertext: 'live-after-refresh',
      timestamp: 200,
    });

    await waitFor(() => {
      expect(screen.getByText('decrypted:live-after-refresh')).toBeInTheDocument();
    });
  });

  it('restores verified peer state after remount', async () => {
    const { unmount } = render(<ChatRoom user={user} room={room} onLogout={vi.fn()} />);

    const firstSocket = await waitForSocket();
    completeHandshake(firstSocket);

    await userEvent.click(await screen.findByRole('button', { name: 'View safety number' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Mark as verified' }));
    expect(await screen.findByText('Peer verified')).toBeInTheDocument();

    unmount();
    render(<ChatRoom user={user} room={room} onLogout={vi.fn()} />);

    const secondSocket = await waitForSocketCount(2);
    completeHandshake(secondSocket);

    expect(await screen.findByText('Peer verified')).toBeInTheDocument();
  });

  it('shows verification reset when the peer key changes and still allows messaging', async () => {
    render(<ChatRoom user={user} room={room} onLogout={vi.fn()} />);

    const socket = await waitForSocket();
    completeHandshake(socket);

    await userEvent.click(await screen.findByRole('button', { name: 'View safety number' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Mark as verified' }));
    expect(await screen.findByText('Peer verified')).toBeInTheDocument();

    socket.receive({
      type: 'public_key',
      userId: 'peer-1',
      publicKey: 'changed-peer-public-key',
      roomId: 'room-1',
    });

    expect(await screen.findByText('Peer key changed - verification reset')).toBeInTheDocument();

    const input = await screen.findByPlaceholderText('Type a message...');
    await userEvent.type(input, 'still works');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => {
      expect(sentMessages(socket)).toContainEqual({
        type: 'ciphertext',
        id: 'message-id-1',
        clientMessageId: 'message-id-1',
        roomId: 'room-1',
        ciphertext: 'encrypted:still works',
        timestamp: expect.any(Number),
      });
    });
    expect(screen.getByText('Peer key changed - verification reset')).toBeInTheDocument();
  });

  it('keeps encrypted local room state when switching rooms', async () => {
    render(<ChatRoom user={user} room={room} onLogout={vi.fn()} />);

    const firstSocket = await waitForSocket();
    completeHandshake(firstSocket);

    const input = await screen.findByPlaceholderText('Type a message...');
    await userEvent.type(input, 'keep me');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(async () => {
      expect(await readEncryptedRecordsForTest('user-1', 'room-1')).not.toEqual([]);
    });

    await userEvent.click(await screen.findByText('ROOM2'));

    await waitForSocketCount(2);
    expect(firstSocket.closeCalls).toBeGreaterThan(0);
    expect(FakeWebSocket.instances).toHaveLength(2);

    await waitFor(async () => {
      const records = await readEncryptedRecordsForTest('user-1', 'room-1');
      expect(records.length).toBeGreaterThan(0);
    });

    expect(vi.mocked(apiFetch).mock.calls).not.toContainEqual([
      '/users/user-1/rooms/room-1',
      expect.objectContaining({ method: 'DELETE' }),
    ]);
  });

  it('does not send a pending room message through the next selected room socket', async () => {
    render(<ChatRoom user={user} room={room} onLogout={vi.fn()} />);

    const firstSocket = await waitForSocket();
    const input = await screen.findByPlaceholderText('Type a message...');
    await userEvent.type(input, 'room one queued');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText('room one queued')).toBeInTheDocument();

    await userEvent.click(await screen.findByText('ROOM2'));

    const secondSocket = await waitForSocketCount(2);
    completeHandshake(secondSocket, 'room-two-peer-key', 'room-2');

    await waitFor(() => {
      expect(screen.getByText('Secure session ready')).toBeInTheDocument();
    });
    expect(sentCiphertexts(firstSocket)).toEqual([]);
    expect(sentCiphertexts(secondSocket)).toEqual([]);

    firstSocket.open();
    firstSocket.receive({ type: 'auth_ok', userId: 'user-1' });
    firstSocket.receive({ type: 'joined', roomId: 'room-1' });
    firstSocket.receive({
      type: 'public_key',
      userId: 'peer-1',
      publicKey: 'peer-public-key',
      roomId: 'room-1',
    });

    expect(sentCiphertexts(firstSocket)).toEqual([]);
    expect(sentCiphertexts(secondSocket)).toEqual([]);
  });

  it('flushes rapid Room A, Room B, Room A sends to the correct room sockets', async () => {
    render(<ChatRoom user={user} room={room} onLogout={vi.fn()} />);

    const firstRoomASocket = await waitForSocket();
    completeHandshake(firstRoomASocket);

    let input = await screen.findByPlaceholderText('Type a message...');
    await userEvent.type(input, 'room a first');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => {
      expect(sentCiphertexts(firstRoomASocket)).toContainEqual(
        expect.objectContaining({ clientMessageId: 'message-id-1', roomId: 'room-1' }),
      );
    });

    await userEvent.click(await screen.findByText('ROOM2'));
    const roomBSocket = await waitForSocketCount(2);
    input = await screen.findByPlaceholderText('Type a message...');
    await userEvent.type(input, 'room b queued');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(sentCiphertexts(roomBSocket)).toEqual([]);
    completeHandshake(roomBSocket, 'room-two-peer-key', 'room-2');
    await waitFor(() => {
      expect(sentCiphertexts(roomBSocket)).toContainEqual(
        expect.objectContaining({ clientMessageId: 'message-id-2', roomId: 'room-2' }),
      );
    });

    await userEvent.click(await screen.findByText('ROOM1'));
    const secondRoomASocket = await waitForSocketCount(3);
    input = await screen.findByPlaceholderText('Type a message...');
    await userEvent.type(input, 'room a second queued');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(sentCiphertexts(secondRoomASocket)).toEqual([]);
    completeHandshake(secondRoomASocket);
    await waitFor(() => {
      expect(sentCiphertexts(secondRoomASocket)).toContainEqual(
        expect.objectContaining({ clientMessageId: 'message-id-3', roomId: 'room-1' }),
      );
    });
  });

  it('flushes a pending Room A message only after returning to Room A', async () => {
    render(<ChatRoom user={user} room={room} onLogout={vi.fn()} />);

    const firstRoomASocket = await waitForSocket();
    const input = await screen.findByPlaceholderText('Type a message...');
    await userEvent.type(input, 'room a pending');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText('room a pending')).toBeInTheDocument();

    await userEvent.click(await screen.findByText('ROOM2'));
    const roomBSocket = await waitForSocketCount(2);
    completeHandshake(roomBSocket, 'room-two-peer-key', 'room-2');

    await waitFor(() => {
      expect(screen.getByText('Secure session ready')).toBeInTheDocument();
    });
    expect(sentCiphertexts(firstRoomASocket)).toEqual([]);
    expect(sentCiphertexts(roomBSocket)).toEqual([]);

    await userEvent.click(await screen.findByText('ROOM1'));
    const secondRoomASocket = await waitForSocketCount(3);
    completeHandshake(secondRoomASocket);

    await waitFor(() => {
      expect(sentCiphertexts(secondRoomASocket)).toContainEqual(
        expect.objectContaining({
          clientMessageId: 'message-id-1',
          roomId: 'room-1',
          ciphertext: 'encrypted:room a pending',
        }),
      );
    });
  });

  it('makes a sending message retryable when the socket closes before server acceptance', async () => {
    render(<ChatRoom user={user} room={room} onLogout={vi.fn()} />);

    const firstSocket = await waitForSocket();
    completeHandshake(firstSocket);

    const input = await screen.findByPlaceholderText('Type a message...');
    await userEvent.type(input, 'retry after close');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => {
      expect(sentCiphertexts(firstSocket)).toHaveLength(1);
    });

    firstSocket.unexpectedClose();

    expect(await screen.findByText(/Waiting for connection/)).toBeInTheDocument();
    const secondSocket = await waitForSocketCount(2);
    completeHandshake(secondSocket);

    await waitFor(() => {
      expect(sentCiphertexts(secondSocket)).toContainEqual(
        expect.objectContaining({
          clientMessageId: 'message-id-1',
          roomId: 'room-1',
          ciphertext: 'encrypted:retry after close',
        }),
      );
    });
    expect(ratchetEncrypt).toHaveBeenCalledTimes(1);
  });

  it('marks a zero-recipient accepted message as sent when peer is offline', async () => {
    render(<ChatRoom user={user} room={room} onLogout={vi.fn()} />);

    const socket = await waitForSocket();
    completeHandshake(socket);

    const input = await screen.findByPlaceholderText('Type a message...');
    await userEvent.type(input, 'no recipient yet');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => {
      expect(sentCiphertexts(socket)).toHaveLength(1);
    });

    socket.receive({
      type: 'message.accepted',
      id: 'message-id-1',
      clientMessageId: 'message-id-1',
      roomId: 'room-1',
      relayAttempted: false,
      relayTargetCount: 0,
    });

    expect(await screen.findByText(/Sent/)).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 1200));
    expect(sentCiphertexts(socket)).toHaveLength(1);
  });

  it('does not mark a switched-away room message delivered from stale socket acks', async () => {
    render(<ChatRoom user={user} room={room} onLogout={vi.fn()} />);

    const firstSocket = await waitForSocket();
    completeHandshake(firstSocket);

    const input = await screen.findByPlaceholderText('Type a message...');
    await userEvent.type(input, 'switch before ack');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => {
      expect(sentCiphertexts(firstSocket)).toHaveLength(1);
    });

    await userEvent.click(await screen.findByText('ROOM2'));
    const secondSocket = await waitForSocketCount(2);
    completeHandshake(secondSocket, 'room-two-peer-key', 'room-2');

    firstSocket.receive({
      type: 'message.accepted',
      id: 'message-id-1',
      clientMessageId: 'message-id-1',
      roomId: 'room-1',
    });
    firstSocket.receive({
      type: 'message.delivered',
      id: 'message-id-1',
      clientMessageId: 'message-id-1',
      roomId: 'room-1',
    });

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(screen.queryByText('switch before ack')).not.toBeInTheDocument();
    expect(screen.queryByText(/Delivered/)).not.toBeInTheDocument();
  });

  it('ignores recipient delivery acks from stale socket generations', async () => {
    render(<ChatRoom user={user} room={room} onLogout={vi.fn()} />);

    const firstSocket = await waitForSocket();
    completeHandshake(firstSocket);

    const input = await screen.findByPlaceholderText('Type a message...');
    await userEvent.type(input, 'stale delivered');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => {
      expect(sentCiphertexts(firstSocket)).toHaveLength(1);
    });

    firstSocket.unexpectedClose();
    const secondSocket = await waitForSocketCount(2);
    completeHandshake(secondSocket);

    firstSocket.receive({
      type: 'message.delivered',
      id: 'message-id-1',
      clientMessageId: 'message-id-1',
      roomId: 'room-1',
    });

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(screen.queryByText(/Delivered/)).not.toBeInTheDocument();
  });

  it('renders a relayed inbound message once and acknowledges duplicate relays without decrypting twice', async () => {
    render(<ChatRoom user={user} room={room} onLogout={vi.fn()} />);

    const socket = await waitForSocket();
    completeHandshake(socket);
    vi.mocked(ratchetEncrypt).mockClear();

    const inbound = {
      type: 'ciphertext',
      id: 'inbound-duplicate',
      clientMessageId: 'inbound-duplicate',
      roomId: 'room-1',
      from: 'peer-1',
      ciphertext: 'duplicate-ciphertext',
      timestamp: 200,
    };
    socket.receive(inbound);
    socket.receive(inbound);

    expect(await screen.findByText('decrypted:duplicate-ciphertext')).toBeInTheDocument();
    expect(screen.getAllByText('decrypted:duplicate-ciphertext')).toHaveLength(1);
    await waitFor(() => {
      expect(
        sentMessages(socket).filter((message) => message.type === 'message.delivered'),
      ).toHaveLength(2);
    });
  });

  it('queues wrong-room inbound messages for later decryption', async () => {
    render(<ChatRoom user={user} room={room} onLogout={vi.fn()} />);

    const socket = await waitForSocket();
    completeHandshake(socket);

    socket.receive({
      type: 'ciphertext',
      id: 'wrong-room-inbound',
      clientMessageId: 'wrong-room-inbound',
      roomId: 'room-2',
      from: 'peer-1',
      ciphertext: 'wrong-room-ciphertext',
      timestamp: 200,
    });

    await waitFor(async () => {
      const records = await readEncryptedRecordsForTest('user-1', 'room-2');
      expect(records.some((record) => record.type === 'pending-ciphertext')).toBe(true);
    });
    expect(screen.queryByText('decrypted:wrong-room-ciphertext')).not.toBeInTheDocument();

    socket.receive({
      type: 'ciphertext',
      id: 'right-room-inbound',
      clientMessageId: 'right-room-inbound',
      roomId: 'room-1',
      from: 'peer-1',
      ciphertext: 'right-room-ciphertext',
      timestamp: 201,
    });

    expect(await screen.findByText('decrypted:right-room-ciphertext')).toBeInTheDocument();

    await userEvent.click(await screen.findByText('ROOM2'));
    const secondSocket = await waitForSocketCount(2);
    completeHandshake(secondSocket, 'room-two-peer-key', 'room-2');

    expect(await screen.findByText('decrypted:wrong-room-ciphertext')).toBeInTheDocument();

    // Draining the queued ciphertext must remove its pending record (no leak).
    await waitFor(async () => {
      const records = await readEncryptedRecordsForTest('user-1', 'room-2');
      expect(records.some((record) => record.type === 'pending-ciphertext')).toBe(false);
    });
  });

  it('retries the same encrypted envelope without duplicating the transcript bubble', async () => {
    render(<ChatRoom user={user} room={room} onLogout={vi.fn()} />);

    const socket = await waitForSocket();
    completeHandshake(socket);
    expect(await screen.findByText('Secure session ready')).toBeInTheDocument();

    const input = await screen.findByPlaceholderText('Type a message...');
    await userEvent.type(input, 'retry me');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => {
      expect(sentCiphertexts(socket)).toHaveLength(1);
    });
    await waitFor(
      () => {
        expect(sentCiphertexts(socket).length).toBeGreaterThanOrEqual(2);
      },
      { timeout: 1200 },
    );

    const ciphertexts = sentCiphertexts(socket);
    expect(ciphertexts[0]).toMatchObject({
      id: 'message-id-1',
      clientMessageId: 'message-id-1',
      ciphertext: 'encrypted:retry me',
    });
    expect(ciphertexts[1]).toMatchObject({
      id: 'message-id-1',
      clientMessageId: 'message-id-1',
      ciphertext: 'encrypted:retry me',
    });
    expect(ratchetEncrypt).toHaveBeenCalledTimes(1);
    expect(screen.getAllByText('retry me')).toHaveLength(1);
  });

  it('marks an unacknowledged outbox message failed and allows manual retry', async () => {
    render(<ChatRoom user={user} room={room} onLogout={vi.fn()} />);

    const socket = await waitForSocket();
    completeHandshake(socket);
    expect(await screen.findByText('Secure session ready')).toBeInTheDocument();

    const input = await screen.findByPlaceholderText('Type a message...');
    await userEvent.type(input, 'eventually fails');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));

    expect(await screen.findByText('eventually fails')).toBeInTheDocument();
    expect(await screen.findByText(/Failed/, {}, { timeout: 2500 })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => {
      expect(sentCiphertexts(socket).length).toBeGreaterThan(3);
    });
  });

  it('stores queued plaintext only inside encrypted local records', async () => {
    render(<ChatRoom user={user} room={room} onLogout={vi.fn()} />);

    await waitForSocket();
    const input = await screen.findByPlaceholderText('Type a message...');
    await userEvent.type(input, 'secret pending text');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(async () => {
      const records = await readEncryptedRecordsForTest('user-1', 'room-1');
      expect(records.some((record) => record.type === 'outbox-entry')).toBe(true);
      expect(JSON.stringify(records)).not.toContain('secret pending text');
    });
  });
});
