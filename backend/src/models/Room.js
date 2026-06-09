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
  const stmt = db.prepare(
    'INSERT OR IGNORE INTO user_rooms (user_id, room_id, joined_at) VALUES (?, ?, ?)',
  );
  stmt.run(userId, roomId, joinedAt);
}

function isUserInRoom(userId, roomId) {
  const row = db
    .prepare('SELECT 1 FROM user_rooms WHERE user_id = ? AND room_id = ?')
    .get(userId, roomId);
  return !!row;
}

function countMembers(roomId) {
  const row = db.prepare('SELECT COUNT(*) AS count FROM user_rooms WHERE room_id = ?').get(roomId);
  return row.count;
}

function findMemberIds(roomId) {
  const rows = db.prepare('SELECT user_id FROM user_rooms WHERE room_id = ?').all(roomId);
  return rows.map((row) => row.user_id);
}

module.exports = {
  create,
  findByCode,
  addUserToRoom,
  addUserToRoomIgnore,
  isUserInRoom,
  countMembers,
  findMemberIds,
};
