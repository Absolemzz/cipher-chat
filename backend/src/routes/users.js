const express = require('express');

const db = require('../db');
const { authFromToken } = require('../middleware/auth');

const router = express.Router();

router.get('/:userId/rooms', (req, res) => {
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
   
  res.json(rooms);
});

router.delete('/:userId/rooms/:roomId', (req, res) => {
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

router.get('/:userId/public-key', (req, res) => {
  const { userId } = req.params;
  const row = db.prepare('SELECT public_key FROM users WHERE id = ?').get(userId);
  if (!row || !row.public_key) return res.status(404).json({ error: 'key not found' });
  res.json({ userId, publicKey: row.public_key });
});

module.exports = router;
