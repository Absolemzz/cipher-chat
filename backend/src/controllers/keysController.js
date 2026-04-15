const keyService = require('../services/keyService');

async function publish(req, res, next) {
  try {
    const { userId, publicKey } = req.body;
    const result = await keyService.publishKey(req.user.id, userId, publicKey);
    res.json(result);
  } catch (error) {
    next(error);
  }
}

async function getLog(req, res, next) {
  try {
    const result = await keyService.getKeyLog(req.params.userId);
    res.json(result);
  } catch (error) {
    next(error);
  }
}

module.exports = { publish, getLog };
