const { v4: uuidv4 } = require('uuid');
const Room = require('../models/Room');

async function createRoomForUser(userId) {
  const id = uuidv4();
  const code = Math.random().toString(36).slice(2, 8);

  Room.create({ id, code });
  Room.addUserToRoom(userId, id, Date.now());

  return { id, code };
}

async function joinRoomByCode(userId, code) {
  const room = Room.findByCode(code);

  if (!room) {
    const error = new Error('room not found');
    error.status = 404;
    throw error;
  }

  Room.addUserToRoomIgnore(userId, room.id, Date.now());

  return { id: room.id, code: room.code };
}

async function getMessagesByRoomId(roomId) {
  return Room.findMessagesByRoomId(roomId);
}

module.exports = {
  createRoomForUser,
  joinRoomByCode,
  getMessagesByRoomId
};