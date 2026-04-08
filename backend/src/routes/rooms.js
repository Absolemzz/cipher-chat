const express = require('express');
const roomsController = require('../controllers/roomsController');

const router = express.Router();

router.post('/', roomsController.createRoom);
router.get('/:code', roomsController.joinRoom);
router.get('/:roomId/messages', roomsController.getRoomMessages);

module.exports = router;
