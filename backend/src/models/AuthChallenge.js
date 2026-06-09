const db = require('../db');

function create({ id, username, purpose, authPublicKey, nonce, challenge, expiresAt }) {
  db.prepare(
    `
    INSERT INTO auth_challenges
      (id, username, purpose, auth_public_key, nonce, challenge, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(id, username, purpose, authPublicKey || null, nonce, challenge, expiresAt);
  return { id, username, purpose, authPublicKey, nonce, challenge, expiresAt };
}

function findById(id) {
  return db
    .prepare(
      `
    SELECT id, username, purpose, auth_public_key, nonce, challenge, expires_at, used_at
    FROM auth_challenges
    WHERE id = ?
  `,
    )
    .get(id);
}

function markUsed(id, usedAt) {
  return db
    .prepare('UPDATE auth_challenges SET used_at = ? WHERE id = ? AND used_at IS NULL')
    .run(usedAt, id);
}

function deleteExpired(now) {
  return db.prepare('DELETE FROM auth_challenges WHERE expires_at < ?').run(now);
}

module.exports = {
  create,
  findById,
  markUsed,
  deleteExpired,
};
