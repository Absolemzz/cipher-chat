const WebSocket = require('ws');
const crypto = require('crypto');
const db = require('../db');
const Room = require('../models/Room');
const { recordWsError } = require('../metrics');

const rooms = new Map();
const connectionsByUser = new Map();
const MAX_ROOM_MEMBERS = 2;
const MESSAGE_DEDUPE_TTL_MS = 10 * 60 * 1000;
const acceptedClientMessages = new Map();
const DEBUG_CHAT = process.env.DEBUG_CHAT === 'true';

function registerConnection(ws) {
  const userId = ws._user?.id;
  if (!userId) return;
  if (!connectionsByUser.has(userId)) connectionsByUser.set(userId, new Set());
  connectionsByUser.get(userId).add(ws);
}

function unregisterConnection(ws) {
  const userId = ws._user?.id;
  if (!userId) return;
  const clients = connectionsByUser.get(userId);
  if (!clients) return;
  clients.delete(ws);
  if (clients.size === 0) connectionsByUser.delete(userId);
}

function openConnectionsForUser(userId) {
  const clients = connectionsByUser.get(userId);
  if (!clients) return [];
  return [...clients].filter((client) => client.readyState === WebSocket.OPEN);
}

function relayToRoomMembers(roomId, senderUserId, payload) {
  const memberIds = Room.findMemberIds(roomId);
  let relayTargetCount = 0;
  for (const memberId of memberIds) {
    if (memberId === senderUserId) continue;
    for (const client of openConnectionsForUser(memberId)) {
      client.send(JSON.stringify(payload));
      relayTargetCount += 1;
    }
  }
  return relayTargetCount;
}

function sendError(ws, message, event = 'room_error') {
  recordWsError(event);
  ws._log?.warn({ wsError: message }, 'websocket error sent');
  ws.send(JSON.stringify({ type: 'error', message }));
}

function handleJoin(msg, ws, user) {
  const roomId = msg.roomId;
  if (!roomId) {
    sendError(ws, 'join: roomId required', 'join_missing_room');
    return;
  }

  const roomExists = db.prepare('SELECT 1 FROM rooms WHERE id = ?').get(roomId);
  if (!roomExists) {
    sendError(ws, 'join: room does not exist', 'join_room_not_found');
    return;
  }

  if (!Room.isUserInRoom(user.id, roomId)) {
    sendError(ws, 'join: not a member of this room', 'join_not_member');
    return;
  }

  const members = Room.findMemberIds(roomId);
  const otherMemberCount = members.filter((memberId) => memberId !== user.id).length;
  if (members.length > MAX_ROOM_MEMBERS || otherMemberCount > MAX_ROOM_MEMBERS - 1) {
    sendError(ws, 'join: room is full', 'join_room_full');
    return;
  }

  ws._roomId = roomId;
  if (!rooms.has(roomId)) rooms.set(roomId, new Set());
  rooms.get(roomId).add(ws);

  const peers = db
    .prepare('SELECT user_id FROM user_rooms WHERE room_id = ? AND user_id != ?')
    .all(roomId, user.id);
  for (const p of peers) {
    const row = db.prepare('SELECT public_key FROM users WHERE id = ?').get(p.user_id);
    if (row?.public_key) {
      ws.send(
        JSON.stringify({
          type: 'public_key',
          userId: p.user_id,
          publicKey: row.public_key,
          roomId,
        }),
      );
    }
  }

  ws.send(JSON.stringify({ type: 'joined', roomId }));
  ws._log?.info({ roomId }, 'websocket room joined');
}

function handlePublicKey(msg, ws, user) {
  const roomId = msg.roomId;
  if (!roomId || roomId !== ws._roomId) {
    sendError(ws, 'public_key: join room first or room mismatch', 'public_key_room_mismatch');
    return;
  }

  if (!Room.isUserInRoom(user.id, roomId)) {
    sendError(ws, 'public_key: not a member of this room', 'public_key_not_member');
    return;
  }

  const { publicKey } = msg;
  if (!publicKey) {
    sendError(ws, 'public_key: missing publicKey', 'public_key_missing');
    return;
  }

  const clients = rooms.get(roomId) || new Set();
  for (const client of clients) {
    if (client !== ws && client.readyState === WebSocket.OPEN) {
      client.send(
        JSON.stringify({
          type: 'public_key',
          userId: user.id,
          publicKey,
          roomId,
        }),
      );
    }
  }
}

function handleCiphertext(msg, ws, user) {
  const { roomId, ciphertext } = msg;
  if (!roomId || roomId !== ws._roomId) {
    sendError(ws, 'ciphertext: join room first or room mismatch', 'ciphertext_room_mismatch');
    return;
  }

  if (!Room.isUserInRoom(user.id, roomId)) {
    sendError(ws, 'ciphertext: not a member of this room', 'ciphertext_not_member');
    return;
  }

  if (!ciphertext || typeof ciphertext !== 'string') {
    sendError(ws, 'ciphertext: missing or invalid ciphertext', 'ciphertext_invalid');
    return;
  }

  const id = msg.clientMessageId || msg.id || crypto.randomUUID();
  const timestamp = Date.now();
  pruneAcceptedClientMessages(timestamp);

  const dedupeKey = clientMessageDedupeKey(roomId, user.id, id);
  const duplicateMessage = acceptedClientMessages.get(dedupeKey);
  if (duplicateMessage) {
    chatDebug(ws, 'ciphertext.duplicate', {
      clientMessageId: id,
      roomId,
      senderUserId: user.id,
      duplicate: true,
      relayTargetCount: duplicateMessage.relayTargetCount,
      relayAttempted: false,
    });
    sendAcceptedAck(ws, id, roomId, timestamp, {
      duplicate: true,
      relayAttempted: false,
      relayTargetCount: duplicateMessage.relayTargetCount,
    });
    return;
  }

  // Ciphertext is relayed in-memory only; the server intentionally keeps no
  // message store (see threat model). Delivery to an offline peer is therefore
  // not durable — reflected to the sender via relayTargetCount on the ack.
  const payload = {
    type: 'ciphertext',
    id,
    clientMessageId: id,
    roomId,
    ciphertext,
    from: user.id,
    timestamp,
  };
  const relayTargetCount = relayToRoomMembers(roomId, user.id, payload);
  chatDebug(ws, 'ciphertext.received', {
    clientMessageId: id,
    roomId,
    senderUserId: user.id,
    duplicate: false,
    relayTargetCount,
    relayAttempted: relayTargetCount > 0,
  });

  if (relayTargetCount > 0) {
    acceptedClientMessages.set(dedupeKey, {
      acceptedAt: timestamp,
      clientMessageId: id,
      relayTargetCount,
      roomId,
      senderUserId: user.id,
    });
  }

  sendAcceptedAck(ws, id, roomId, timestamp, {
    duplicate: false,
    relayAttempted: relayTargetCount > 0,
    relayTargetCount,
  });
}

function handleMessageDelivered(msg, ws, user) {
  const { roomId, clientMessageId } = msg;
  if (!roomId) {
    sendError(ws, 'message.delivered: roomId required', 'delivered_missing_room');
    return;
  }

  if (!Room.isUserInRoom(user.id, roomId)) {
    sendError(ws, 'message.delivered: not a member of this room', 'delivered_not_member');
    return;
  }

  if (!clientMessageId || typeof clientMessageId !== 'string') {
    sendError(ws, 'message.delivered: missing clientMessageId', 'delivered_missing_id');
    return;
  }

  const timestamp = Date.now();
  pruneAcceptedClientMessages(timestamp);
  const acceptedMessage = findAcceptedMessageForDelivery(roomId, user.id, clientMessageId);
  if (!acceptedMessage) {
    sendError(ws, 'message.delivered: unknown message', 'delivered_unknown_message');
    return;
  }

  const clients = connectionsByUser.get(acceptedMessage.senderUserId) || new Set();
  let forwardedCount = 0;
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(
        JSON.stringify({
          type: 'message.delivered',
          id: clientMessageId,
          clientMessageId,
          roomId,
          timestamp,
        }),
      );
      forwardedCount += 1;
    }
  }
  chatDebug(ws, 'delivery_ack.forwarded', {
    clientMessageId,
    roomId,
    senderUserId: acceptedMessage.senderUserId,
    recipientUserId: user.id,
    relayTargetCount: forwardedCount,
    relayAttempted: forwardedCount > 0,
  });
}

function handleDisconnect(ws) {
  unregisterConnection(ws);
  if (ws._roomId && rooms.has(ws._roomId)) {
    rooms.get(ws._roomId).delete(ws);
  }
}

function clientMessageDedupeKey(roomId, userId, clientMessageId) {
  return `${roomId}:${userId}:${clientMessageId}`;
}

function pruneAcceptedClientMessages(now) {
  for (const [key, entry] of acceptedClientMessages.entries()) {
    if (now - entry.acceptedAt > MESSAGE_DEDUPE_TTL_MS) {
      acceptedClientMessages.delete(key);
    }
  }
}

function findAcceptedMessageForDelivery(roomId, recipientUserId, clientMessageId) {
  for (const entry of acceptedClientMessages.values()) {
    if (
      entry.roomId === roomId &&
      entry.clientMessageId === clientMessageId &&
      entry.senderUserId !== recipientUserId
    ) {
      return entry;
    }
  }
  return null;
}

function sendAcceptedAck(ws, clientMessageId, roomId, timestamp, relayMetadata) {
  ws.send(
    JSON.stringify({
      type: 'message.accepted',
      id: clientMessageId,
      clientMessageId,
      duplicate: relayMetadata.duplicate,
      relayAttempted: relayMetadata.relayAttempted,
      relayTargetCount: relayMetadata.relayTargetCount,
      roomId,
      timestamp,
    }),
  );
}

function chatDebug(ws, event, metadata) {
  if (!DEBUG_CHAT) return;
  ws._log?.info({ chatTrace: { event, ...metadata } }, 'chat lifecycle trace');
}

module.exports = {
  handleJoin,
  handlePublicKey,
  handleCiphertext,
  handleMessageDelivered,
  handleDisconnect,
  registerConnection,
  unregisterConnection,
};
