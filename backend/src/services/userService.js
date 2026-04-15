const User = require('../models/User');

async function getRooms(requesterId, userId) {
  if (requesterId !== userId) {
    const error = new Error('cannot access another user\'s rooms');
    error.status = 403;
    throw error;
  }
  return User.findRoomsByUserId(userId);
}

async function leaveRoom(requesterId, userId, roomId) {
  if (requesterId !== userId) {
    const error = new Error('cannot modify another user\'s rooms');
    error.status = 403;
    throw error;
  }
  User.removeFromRoom(userId, roomId);
  return User.findRoomsByUserId(userId);
}

async function getPublicKey(userId) {
  const row = User.findPublicKey(userId);
  if (!row || !row.public_key) {
    const error = new Error('key not found');
    error.status = 404;
    throw error;
  }
  return { userId, publicKey: row.public_key };
}

module.exports = { getRooms, leaveRoom, getPublicKey };
