const db = require('../db');

function saveMessage(id, roomId, senderId, ciphertext, timestamp) {
  db.prepare('INSERT INTO messages (id, room_id, sender_id, ciphertext, timestamp) VALUES (?, ?, ?, ?, ?)')
    .run(id, roomId, senderId, ciphertext, timestamp);
}

module.exports = { saveMessage };