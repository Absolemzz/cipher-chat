const express = require('express');
const { v4: uuidv4 } = require('uuid');

const db = require('../db');
const { authFromToken } = require('../middleware/auth');

const router = express.Router();

router.post('/', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const user = authFromToken(token);
  if (!user) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  
  const id = uuidv4();
  const code = Math.random().toString(36).slice(2, 8);
  db.prepare('INSERT INTO rooms (id, code) VALUES (?, ?)').run(id, code);
  
  db.prepare('INSERT INTO user_rooms (user_id, room_id, joined_at) VALUES (?, ?, ?)').run(user.id, id, Date.now());
  
  res.json({ id, code });
});

router.get('/:code', (req, res) => {
  const { code } = req.params;
  const token = req.headers.authorization?.replace('Bearer ', '');
  const user = authFromToken(token);
  if (!user) return res.status(401).json({ error: 'unauthorized' });
  
  const row = db.prepare('SELECT id, code FROM rooms WHERE code = ?').get(code);
  if (!row) return res.status(404).json({ error: 'room not found' });
  
  db.prepare('INSERT OR IGNORE INTO user_rooms (user_id, room_id, joined_at) VALUES (?, ?, ?)').run(user.id, row.id, Date.now());
  
  res.json({ id: row.id, code: row.code });
});

router.get('/:roomId/messages', (req, res) => {
  const { roomId } = req.params;
  const token = req.headers.authorization?.replace('Bearer ', '');
  const user = authFromToken(token);
  if (!user) return res.status(401).json({ error: 'unauthorized' });
  
  const messages = db.prepare('SELECT id, sender_id, ciphertext, timestamp FROM messages WHERE room_id = ? ORDER BY timestamp ASC').all(roomId);
  res.json(messages);
});

module.exports = router;
