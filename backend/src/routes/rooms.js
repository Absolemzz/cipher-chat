const express = require('express');
const { requireAuth } = require('../middleware/auth');
const roomsController = require('../controllers/roomsController');
const { validate } = require('../middleware/validate');
const { roomCodeParam, roomMessagesParam } = require('../schemas');

const router = express.Router();
router.use(requireAuth);

router.post('/', roomsController.createRoom);
router.get('/:code', validate(roomCodeParam), roomsController.joinRoom);
router.get('/:roomId/messages', validate(roomMessagesParam), roomsController.getRoomMessages);

module.exports = router;
