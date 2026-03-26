const Database = require('better-sqlite3');

const db = new Database('./data/messages.db');
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT,
  public_key TEXT,
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

try {
  db.exec('ALTER TABLE users ADD COLUMN public_key TEXT');
} catch (e) {
  
}

module.exports = db;
