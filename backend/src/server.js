// WebSocket relay server - stores encrypted messages, handles auth and room management
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const bodyParser = require('body-parser');
const cors = require('cors');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const Database = require('better-sqlite3');

const PORT = process.env.BACKEND_PORT || 4000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_for_demo_only';

const app = express();
app.use(bodyParser.json());
app.use(cors());
app.use(morgan('tiny'));

const db = new Database('./data/messages.db');
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT,
  public_key_hash TEXT
);
CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY,
  code TEXT
);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  room_id TEXT,
  sender_id TEXT,
  ciphertext TEXT,
  timestamp INTEGER
);
CREATE TABLE IF NOT EXISTS user_rooms (
  user_id TEXT,
  room_id TEXT,
  joined_at INTEGER,
  PRIMARY KEY (user_id, room_id)
);
`);

const limiter = rateLimit({ windowMs: 15*60*1000, max: 200 });
app.use(limiter);

function authFromToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (e) {
    return null;
  }
}

app.post('/auth/register', (req, res) => {
  const { username, publicKeyHash } = req.body;
  if (!username) return res.status(400).json({ error: 'username required' });
  const id = uuidv4();
  const stmt = db.prepare('INSERT INTO users (id, username, public_key_hash) VALUES (?, ?, ?)');
  stmt.run(id, username, publicKeyHash || null);
  const token = jwt.sign({ id, username }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ id, username, token });
});

app.post('/auth/login', (req, res) => {
  const { username } = req.body;
  const row = db.prepare('SELECT id, username FROM users WHERE username = ?').get(username);
  if (!row) return res.status(404).json({ error: 'user not found' });
  const token = jwt.sign({ id: row.id, username: row.username }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ id: row.id, username: row.username, token });
});

app.post('/rooms', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const user = authFromToken(token);
  if (!user) {
    console.log('Room creation failed: unauthorized');
    return res.status(401).json({ error: 'unauthorized' });
  }
  
  const id = uuidv4();
  const code = Math.random().toString(36).slice(2, 8);
  db.prepare('INSERT INTO rooms (id, code) VALUES (?, ?)').run(id, code);
  
  // Add host to the room
  db.prepare('INSERT INTO user_rooms (user_id, room_id, joined_at) VALUES (?, ?, ?)').run(user.id, id, Date.now());
  
  console.log(`User ${user.id} created and joined room ${id} (${code})`);
  
  res.json({ id, code });
});

app.get('/rooms/:code', (req, res) => {
  const { code } = req.params;
  const token = req.headers.authorization?.replace('Bearer ', '');
  const user = authFromToken(token);
  if (!user) return res.status(401).json({ error: 'unauthorized' });
  
  const row = db.prepare('SELECT id, code FROM rooms WHERE code = ?').get(code);
  if (!row) return res.status(404).json({ error: 'room not found' });
  
  // Add user to room when they join
  db.prepare('INSERT OR IGNORE INTO user_rooms (user_id, room_id, joined_at) VALUES (?, ?, ?)').run(user.id, row.id, Date.now());
  
  console.log(`User ${user.id} joined room ${row.id} (${code})`);
  
  res.json({ id: row.id, code: row.code });
});

app.get('/users/:userId/rooms', (req, res) => {
  const { userId } = req.params;
  const token = req.headers.authorization?.replace('Bearer ', '');
  const user = authFromToken(token);
  if (!user || user.id !== userId) return res.status(401).json({ error: 'unauthorized' });
  
  const rooms = db.prepare(`
    SELECT r.id, r.code, ur.joined_at 
    FROM user_rooms ur 
    JOIN rooms r ON ur.room_id = r.id 
    WHERE ur.user_id = ? 
    ORDER BY ur.joined_at DESC
  `).all(userId);
  
  console.log(`Fetching rooms for user ${userId}:`, rooms);
  
  res.json(rooms);
});

app.post('/keys/publish', (req, res) => {
  const { userId, publicKeyHash } = req.body;
  if (!userId || !publicKeyHash) return res.status(400).json({ error: 'missing' });
  db.prepare('UPDATE users SET public_key_hash = ? WHERE id = ?').run(publicKeyHash, userId);
  res.json({ ok: true });
});

app.get('/rooms/:roomId/messages', (req, res) => {
  const { roomId } = req.params;
  const token = req.headers.authorization?.replace('Bearer ', '');
  const user = authFromToken(token);
  if (!user) return res.status(401).json({ error: 'unauthorized' });
  
  const messages = db.prepare('SELECT id, sender_id, ciphertext, timestamp FROM messages WHERE room_id = ? ORDER BY timestamp ASC').all(roomId);
  res.json(messages);
});

app.delete('/users/:userId/rooms/:roomId', (req, res) => {
  const { userId, roomId } = req.params;
  const token = req.headers.authorization?.replace('Bearer ', '');
  const user = authFromToken(token);
  if (!user || user.id !== userId) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  db.prepare('DELETE FROM user_rooms WHERE user_id = ? AND room_id = ?').run(userId, roomId);

  const rooms = db.prepare(`
    SELECT r.id, r.code, ur.joined_at 
    FROM user_rooms ur 
    JOIN rooms r ON ur.room_id = r.id 
    WHERE ur.user_id = ? 
    ORDER BY ur.joined_at DESC
  `).all(userId);

  res.json(rooms);
});

const server = http.createServer(app);
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
        
        // Track user joining this room
        db.prepare('INSERT OR IGNORE INTO user_rooms (user_id, room_id, joined_at) VALUES (?, ?, ?)').run(user.id, roomId, Date.now());
        
        ws.send(JSON.stringify({ type: 'joined', roomId }));
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
        
        // Broadcast to room
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

server.listen(PORT, () => {
  console.log(`Backend listening on ${PORT}`);
});