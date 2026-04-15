const express = require('express');
const authController = require('../controllers/authController');
const { validate } = require('../middleware/validate');
const { authRegister, authLogin } = require('../schemas');

const router = express.Router();

router.post('/register', validate(authRegister), authController.register);
router.post('/login', validate(authLogin), authController.login);

module.exports = router;