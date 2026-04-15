const express = require('express');
const { requireAuth } = require('../middleware/auth');
const usersController = require('../controllers/usersController');
const { validate } = require('../middleware/validate');
const { userIdParam, userRoomParams, publicKeyParam } = require('../schemas');

const router = express.Router();

router.get('/:userId/rooms', requireAuth, validate(userIdParam), usersController.getRooms);
router.delete('/:userId/rooms/:roomId', requireAuth, validate(userRoomParams), usersController.leaveRoom);
router.get('/:userId/public-key', validate(publicKeyParam), usersController.getPublicKey);

module.exports = router;
