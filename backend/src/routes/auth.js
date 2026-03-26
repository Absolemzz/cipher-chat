const express = require('express');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');

const db = require('../db');

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_for_demo_only';

const router = express.Router();

router.post('/register', (req, res) => {
  const { username, publicKey, publicKeyHash } = req.body;
  if (!username) return res.status(400).json({ error: 'username required' });
  const id = uuidv4();
  db.prepare('INSERT INTO users (id, username, public_key, public_key_hash) VALUES (?, ?, ?, ?)')
    .run(id, username, publicKey || null, publicKeyHash || null);
  const token = jwt.sign({ id, username }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ id, username, token });
});

router.post('/login', (req, res) => {
  const { username } = req.body;
  const row = db.prepare('SELECT id, username FROM users WHERE username = ?').get(username);
  if (!row) return res.status(404).json({ error: 'user not found' });
  const token = jwt.sign({ id: row.id, username: row.username }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ id: row.id, username: row.username, token });
});

module.exports = router;
