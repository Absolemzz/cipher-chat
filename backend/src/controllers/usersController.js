const userService = require('../services/userService');

async function getRooms(req, res, next) {
  try {
    const rooms = await userService.getRooms(req.user.id, req.params.userId);
    res.json(rooms);
  } catch (error) {
    next(error);
  }
}

async function leaveRoom(req, res, next) {
  try {
    const rooms = await userService.leaveRoom(req.user.id, req.params.userId, req.params.roomId);
    res.json(rooms);
  } catch (error) {
    next(error);
  }
}

async function getPublicKey(req, res, next) {
  try {
    const result = await userService.getPublicKey(req.params.userId);
    res.json(result);
  } catch (error) {
    next(error);
  }
}

module.exports = { getRooms, leaveRoom, getPublicKey };
