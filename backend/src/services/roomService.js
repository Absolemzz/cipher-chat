const crypto = require('crypto');
const Room = require('../models/Room');

const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ROOM_CODE_LENGTH = 6;
const MAX_CODE_GENERATION_ATTEMPTS = 10;
const MAX_ROOM_MEMBERS = 2;

function httpError(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function generateRoomCode() {
  let code = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    code += ROOM_CODE_ALPHABET[crypto.randomInt(ROOM_CODE_ALPHABET.length)];
  }
  return code;
}

function isUniqueConstraint(error) {
  return (
    error?.code === 'SQLITE_CONSTRAINT_UNIQUE' || error?.code === 'SQLITE_CONSTRAINT_PRIMARYKEY'
  );
}

async function createRoomForUser(userId) {
  for (let attempt = 0; attempt < MAX_CODE_GENERATION_ATTEMPTS; attempt++) {
    const id = crypto.randomUUID();
    const code = generateRoomCode();

    try {
      Room.create({ id, code });
      Room.addUserToRoom(userId, id, Date.now());
      return { id, code };
    } catch (error) {
      if (!isUniqueConstraint(error)) throw error;
    }
  }

  throw httpError('could not generate a unique room code', 500);
}

async function joinRoomByCode(userId, code) {
  const room = Room.findByCode(code);

  if (!room) {
    throw httpError('room not found', 404);
  }

  if (!Room.isUserInRoom(userId, room.id) && Room.countMembers(room.id) >= MAX_ROOM_MEMBERS) {
    throw httpError('room is full', 409);
  }

  Room.addUserToRoomIgnore(userId, room.id, Date.now());

  return { id: room.id, code: room.code };
}

async function getMessagesByRoomId(userId, roomId) {
  if (!Room.isUserInRoom(userId, roomId)) {
    const error = new Error('not a member of this room');
    error.status = 403;
    throw error;
  }
  throw httpError('server message history is disabled; use local encrypted client history', 410);
}

module.exports = {
  createRoomForUser,
  joinRoomByCode,
  getMessagesByRoomId,
};
