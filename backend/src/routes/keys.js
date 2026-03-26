const express = require('express');

const db = require('../db');

const router = express.Router();

router.post('/publish', (req, res) => {
  const { userId, publicKey } = req.body;
  if (!userId || !publicKey) return res.status(400).json({ error: 'missing' });
  db.prepare('UPDATE users SET public_key = ? WHERE id = ?').run(publicKey, userId);
  res.json({ ok: true });
});

module.exports = router;
