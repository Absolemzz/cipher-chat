const db = require('../db');

function create({ id, code }) {
  const stmt = db.prepare('INSERT INTO rooms (id, code) VALUES (?, ?)');
  stmt.run(id, code);
  return { id, code };
}

function findByCode(code) {
  const stmt = db.prepare('SELECT id, code FROM rooms WHERE code = ?');
  return stmt.get(code);
}

function addUserToRoom(userId, roomId, joinedAt) {
  const stmt = db.prepare('INSERT INTO user_rooms (user_id, room_id, joined_at) VALUES (?, ?, ?)');
  stmt.run(userId, roomId, joinedAt);
}

function addUserToRoomIgnore(userId, roomId, joinedAt) {
  const stmt = db.prepare('INSERT OR IGNORE INTO user_rooms (user_id, room_id, joined_at) VALUES (?, ?, ?)');
  stmt.run(userId, roomId, joinedAt);
}

function findMessagesByRoomId(roomId) {
  const stmt = db.prepare('SELECT id, sender_id, ciphertext, timestamp FROM messages WHERE room_id = ? ORDER BY timestamp ASC');
  return stmt.all(roomId);
}

module.exports = {
  create,
  findByCode,
  addUserToRoom,
  addUserToRoomIgnore,
  findMessagesByRoomId
};