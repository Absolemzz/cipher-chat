const authService = require('../services/authService');

async function register(req, res, next) {
  try {
    const result = await authService.register(req.body || {});
    res.json(result);
  } catch (error) {
    next(error);
  }
}

async function login(req, res, next) {
  try {
    const { username } = req.body || {};
    const result = await authService.login(username);
    res.json(result);
  } catch (error) {
    next(error);
  }
}

module.exports = {
  register,
  login
};
