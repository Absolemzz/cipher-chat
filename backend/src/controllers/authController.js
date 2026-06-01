const authService = require('../services/authService');

async function challenge(req, res, next) {
  try {
    const result = await authService.createChallenge(req.body || {});
    res.json(result);
  } catch (error) {
    next(error);
  }
}

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
    const result = await authService.login(req.body || {});
    res.json(result);
  } catch (error) {
    next(error);
  }
}

module.exports = {
  challenge,
  register,
  login
};
