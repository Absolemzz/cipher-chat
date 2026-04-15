const User = require('../models/User');

async function publishKey(requesterId, userId, publicKey) {
  if (requesterId !== userId) {
    const error = new Error('cannot publish keys for another user');
    error.status = 403;
    throw error;
  }
  const result = User.updatePublicKey(userId, publicKey);
  if (result.changes === 0) {
    const error = new Error('user not found');
    error.status = 404;
    throw error;
  }
  User.appendKeyLog(userId, publicKey, Date.now());
  return { ok: true };
}

async function getKeyLog(userId) {
  const log = User.getKeyLog(userId);
  return { userId, entries: log };
}

module.exports = { publishKey, getKeyLog };
