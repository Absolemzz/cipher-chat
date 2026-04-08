// backend/src/models/User.js
const db = require('../db');

/**
 * Finds a user by their username
 */
function findByUsername(username) {
  const stmt = db.prepare('SELECT id, username FROM users WHERE username = ?');
  return stmt.get(username);
}

/**
 * Creates a new user in the database
 */
function create({ id, username, publicKey, publicKeyHash }) {
  const stmt = db.prepare(
    'INSERT INTO users (id, username, public_key, public_key_hash) VALUES (?, ?, ?, ?)'
  );
  
  // .run() executes the query but doesn't return rows in better-sqlite3
  stmt.run(id, username, publicKey || null, publicKeyHash || null);
  
  // Return the created user object for the service to use
  return { id, username, publicKey, publicKeyHash };
}

module.exports = {
  findByUsername,
  create
};