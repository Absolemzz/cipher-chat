const Database = require('better-sqlite3');

const dbPath = process.env.DB_PATH || './data/messages.db';
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  public_key TEXT,
  public_key_hash TEXT
);
CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY,
  code TEXT UNIQUE NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL,
  sender_id TEXT NOT NULL,
  ciphertext TEXT NOT NULL,
  timestamp INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS user_rooms (
  user_id TEXT NOT NULL,
  room_id TEXT NOT NULL,
  joined_at INTEGER,
  PRIMARY KEY (user_id, room_id)
);
CREATE TABLE IF NOT EXISTS key_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  public_key TEXT NOT NULL,
  published_at INTEGER NOT NULL
);
`);

try { db.exec('ALTER TABLE users ADD COLUMN public_key TEXT'); } catch (_) {}

try {
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username)');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_rooms_code ON rooms(code)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_messages_room ON messages(room_id, timestamp)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_user_rooms_user ON user_rooms(user_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_key_log_user ON key_log(user_id, published_at)');
} catch (_) {}

module.exports = db;
