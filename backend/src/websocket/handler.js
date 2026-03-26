// WebSocket relay server - stores encrypted messages, handles auth and room management
const WebSocket = require('ws');

const db = require('../db');
const { authFromToken } = require('../middleware/auth');

function attachWebSocket(server) {
  const wss = new WebSocket.Server({ server });

  const rooms = new Map(); // roomId -> Set of ws clients

  wss.on('connection', (ws, req) => {
    const params = new URLSearchParams(req.url.replace('/?', ''));
    const token = params.get('token');
    const user = authFromToken(token);
    if (!user) {
      ws.send(JSON.stringify({ type: 'error', message: 'unauthenticated' }));
      ws.close();
      return;
    }
    ws._user = user;

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw);
        
        if (msg.type === 'join') {
          const roomId = msg.roomId;
          ws._roomId = roomId;
          if (!rooms.has(roomId)) rooms.set(roomId, new Set());
          rooms.get(roomId).add(ws);
          
          db.prepare('INSERT OR IGNORE INTO user_rooms (user_id, room_id, joined_at) VALUES (?, ?, ?)').run(user.id, roomId, Date.now());
          
          // E2E bootstrap: send joiner published public keys of other users already in this room
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
          return;
        }

        if (msg.type === 'public_key') {
          const roomId = msg.roomId;
          if (!roomId || roomId !== ws._roomId) {
            ws.send(JSON.stringify({ type: 'error', message: 'public_key: join room first or room mismatch' }));
            return;
          }
          const { publicKey } = msg;
          if (!publicKey) {
            ws.send(JSON.stringify({ type: 'error', message: 'public_key missing' }));
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
          return;
        }
        
        if (msg.type === 'leave') {
          const roomId = msg.roomId;
          if (rooms.has(roomId)) rooms.get(roomId).delete(ws);
          ws.send(JSON.stringify({ type: 'left', roomId }));
          return;
        }
        
        if (msg.type === 'ciphertext') {
          const { roomId, ciphertext, timestamp } = msg;
          const id = msg.id || require('uuid').v4();
          db.prepare('INSERT INTO messages (id, room_id, sender_id, ciphertext, timestamp) VALUES (?, ?, ?, ?, ?)')
            .run(id, roomId, user.id, ciphertext, timestamp || Date.now());
          
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
          return;
        }
      } catch (e) {
        console.error('ws message error', e);
        ws.send(JSON.stringify({ type: 'error', message: 'invalid message' }));
      }
    });

    ws.on('close', () => {
      if (ws._roomId && rooms.has(ws._roomId)) {
        rooms.get(ws._roomId).delete(ws);
      }
    });
  });
}

module.exports = attachWebSocket;
