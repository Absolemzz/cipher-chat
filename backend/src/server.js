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
`);

const limiter = rateLimit({ windowMs: 15*60*1000, max: 200 });
app.use(limiter);

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
  const id = uuidv4();
  const code = Math.random().toString(36).slice(2, 8);
  db.prepare('INSERT INTO rooms (id, code) VALUES (?, ?)').run(id, code);
  res.json({ id, code });
});

app.get('/rooms/:code', (req, res) => {
  const { code } = req.params;
  const row = db.prepare('SELECT id, code FROM rooms WHERE code = ?').get(code);
  if (!row) return res.status(404).json({ error: 'room not found' });
  res.json({ id: row.id, code: row.code });
});

app.post('/keys/publish', (req, res) => {
  const { userId, publicKeyHash } = req.body;
  if (!userId || !publicKeyHash) return res.status(400).json({ error: 'missing' });
  db.prepare('UPDATE users SET public_key_hash = ? WHERE id = ?').run(publicKeyHash, userId);
  res.json({ ok: true });
});

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const rooms = new Map(); // roomId -> Set of ws clients

function authFromToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (e) {
    return null;
  }
}

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
