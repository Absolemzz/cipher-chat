const roomService = require('../services/roomService');

async function createRoom(req, res, next) {
  try {
    const result = await roomService.createRoomForUser(req.user.id);
    res.json(result);
  } catch (error) {
    next(error);
  }
}

async function joinRoom(req, res, next) {
  try {
    const { code } = req.params;
    const result = await roomService.joinRoomByCode(req.user.id, code);
    res.json(result);
  } catch (error) {
    next(error);
  }
}

async function getRoomMessages(req, res, next) {
  try {
    const { roomId } = req.params;
    const messages = await roomService.getMessagesByRoomId(req.user.id, roomId);
    res.json(messages);
  } catch (error) {
    next(error);
  }
}

module.exports = {
  createRoom,
  joinRoom,
  getRoomMessages
};
