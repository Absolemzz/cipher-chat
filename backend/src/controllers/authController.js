// backend/src/controllers/authController.js
const authService = require('../services/authService');

async function register(req, res) {
  try {
    // Defense in Depth: fallback to empty object
    const result = await authService.register(req.body || {});
    res.json(result);
  } catch (error) {
    const status = error.status || 500;
    res.status(status).json({ error: error.message });
  }
}

async function login(req, res) {
  try {
    // Defense in Depth: fallback to empty object
    const { username } = req.body || {}; 
    const result = await authService.login(username);
    res.json(result);
  } catch (error) {
    const status = error.status || 500;
    res.status(status).json({ error: error.message });
  }
}

module.exports = {
  register,
  login
};