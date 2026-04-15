const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const Room = require('../models/Room');
const { saveMessage } = require('./queue');

const rooms = new Map();

function sendError(ws, message) {
  ws.send(JSON.stringify({ type: 'error', message }));
}

function handleJoin(msg, ws, user) {
  const roomId = msg.roomId;
  if (!roomId) {
    sendError(ws, 'join: roomId required');
    return;
  }

  const roomExists = db.prepare('SELECT 1 FROM rooms WHERE id = ?').get(roomId);
  if (!roomExists) {
    sendError(ws, 'join: room does not exist');
    return;
  }

  if (!Room.isUserInRoom(user.id, roomId)) {
    sendError(ws, 'join: not a member of this room');
    return;
  }

  ws._roomId = roomId;
  if (!rooms.has(roomId)) rooms.set(roomId, new Set());
  rooms.get(roomId).add(ws);

  const peers = db.prepare('SELECT user_id FROM user_rooms WHERE room_id = ? AND user_id != ?').all(roomId, user.id);
  for (const p of peers) {
    const row = db.prepare('SELECT public_key FROM users WHERE id = ?').get(p.user_id);
    if (row?.public_key) {
      ws.send(JSON.stringify({
        type: 'public_key',
        userId: p.user_id,
        publicKey: row.public_key,
        roomId
      }));
    }
  }

  ws.send(JSON.stringify({ type: 'joined', roomId }));
}

function handlePublicKey(msg, ws, user) {
  const roomId = msg.roomId;
  if (!roomId || roomId !== ws._roomId) {
    sendError(ws, 'public_key: join room first or room mismatch');
    return;
  }

  if (!Room.isUserInRoom(user.id, roomId)) {
    sendError(ws, 'public_key: not a member of this room');
    return;
  }

  const { publicKey } = msg;
  if (!publicKey) {
    sendError(ws, 'public_key: missing publicKey');
    return;
  }

  const clients = rooms.get(roomId) || new Set();
  for (const client of clients) {
    if (client !== ws && client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({
        type: 'public_key',
        userId: user.id,
        publicKey,
        roomId
      }));
    }
  }
}

function handleLeave(msg, ws) {
  const roomId = msg.roomId;
  if (rooms.has(roomId)) rooms.get(roomId).delete(ws);
  ws.send(JSON.stringify({ type: 'left', roomId }));
}

function handleCiphertext(msg, ws, user) {
  const { roomId, ciphertext, timestamp } = msg;
  if (!roomId || roomId !== ws._roomId) {
    sendError(ws, 'ciphertext: join room first or room mismatch');
    return;
  }

  if (!Room.isUserInRoom(user.id, roomId)) {
    sendError(ws, 'ciphertext: not a member of this room');
    return;
  }

  if (!ciphertext || typeof ciphertext !== 'string') {
    sendError(ws, 'ciphertext: missing or invalid ciphertext');
    return;
  }

  const id = msg.id || uuidv4();

  saveMessage(id, roomId, user.id, ciphertext, timestamp || Date.now());

  const clients = rooms.get(roomId) || new Set();
  for (const client of clients) {
    if (client !== ws && client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({
        type: 'ciphertext',
        id,
        roomId,
        ciphertext,
        from: user.id,
        timestamp: Date.now()
      }));
    }
  }

  ws.send(JSON.stringify({ type: 'delivered', id, roomId, timestamp: Date.now() }));
}

function handleDisconnect(ws) {
  if (ws._roomId && rooms.has(ws._roomId)) {
    rooms.get(ws._roomId).delete(ws);
  }
}

module.exports = {
  handleJoin,
  handlePublicKey,
  handleLeave,
  handleCiphertext,
  handleDisconnect
};