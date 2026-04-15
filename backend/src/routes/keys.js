const express = require('express');
const { requireAuth } = require('../middleware/auth');
const keysController = require('../controllers/keysController');
const { validate } = require('../middleware/validate');
const { keysPublish, keysGetLog } = require('../schemas');

const router = express.Router();
router.use(requireAuth);

router.post('/publish', validate(keysPublish), keysController.publish);
router.get('/:userId/log', validate(keysGetLog), keysController.getLog);

module.exports = router;
