// backend/src/controllers/roomsController.js
const roomService = require('../services/roomService');
const { authFromToken } = require('../middleware/auth');

async function createRoom(req, res) {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    const user = authFromToken(token);

    if (!user) {
      return res.status(401).json({ error: 'unauthorized' });
    }

    const result = await roomService.createRoomForUser(user.id);
    res.json(result);
  } catch (error) {
    const status = error.status || 500;
    res.status(status).json({ error: error.message });
  }
}

async function joinRoom(req, res) {
  try {
    const { code } = req.params;
    const token = req.headers.authorization?.replace('Bearer ', '');
    const user = authFromToken(token);

    if (!user) {
      return res.status(401).json({ error: 'unauthorized' });
    }

    const result = await roomService.joinRoomByCode(user.id, code);
    res.json(result);
  } catch (error) {
    const status = error.status || 500;
    res.status(status).json({ error: error.message });
  }
}

async function getRoomMessages(req, res) {
  try {
    const { roomId } = req.params;
    const token = req.headers.authorization?.replace('Bearer ', '');
    const user = authFromToken(token);

    if (!user) {
      return res.status(401).json({ error: 'unauthorized' });
    }

    const messages = await roomService.getMessagesByRoomId(roomId);
    res.json(messages);
  } catch (error) {
    const status = error.status || 500;
    res.status(status).json({ error: error.message });
  }
}

module.exports = {
  createRoom,
  joinRoom,
  getRoomMessages
};