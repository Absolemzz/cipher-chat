const db = require('../db');

function findByUsername(username) {
  return db.prepare('SELECT id, username FROM users WHERE username = ?').get(username);
}

function create({ id, username, publicKey, publicKeyHash }) {
  db.prepare(
    'INSERT INTO users (id, username, public_key, public_key_hash) VALUES (?, ?, ?, ?)'
  ).run(id, username, publicKey || null, publicKeyHash || null);
  return { id, username, publicKey, publicKeyHash };
}

function findPublicKey(userId) {
  return db.prepare('SELECT public_key FROM users WHERE id = ?').get(userId);
}

function updatePublicKey(userId, publicKey) {
  return db.prepare('UPDATE users SET public_key = ? WHERE id = ?').run(publicKey, userId);
}

function appendKeyLog(userId, publicKey, publishedAt) {
  db.prepare('INSERT INTO key_log (user_id, public_key, published_at) VALUES (?, ?, ?)').run(userId, publicKey, publishedAt);
}

function getKeyLog(userId) {
  return db.prepare('SELECT id, public_key, published_at FROM key_log WHERE user_id = ? ORDER BY published_at ASC').all(userId);
}

function findRoomsByUserId(userId) {
  return db.prepare(`
    SELECT r.id, r.code, ur.joined_at
    FROM user_rooms ur
    JOIN rooms r ON ur.room_id = r.id
    WHERE ur.user_id = ?
    ORDER BY ur.joined_at DESC
  `).all(userId);
}

function removeFromRoom(userId, roomId) {
  db.prepare('DELETE FROM user_rooms WHERE user_id = ? AND room_id = ?').run(userId, roomId);
}

module.exports = {
  findByUsername,
  create,
  findPublicKey,
  updatePublicKey,
  appendKeyLog,
  getKeyLog,
  findRoomsByUserId,
  removeFromRoom,
};