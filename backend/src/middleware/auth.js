const jwt = require('jsonwebtoken');

function getJwtSecret() {
  if (!process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET is required');
  }
  return process.env.JWT_SECRET;
}

function authFromToken(token) {
  try {
    return jwt.verify(token, getJwtSecret());
  } catch (e) {
    return null;
  }
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'missing or malformed authorization header' });
  }
  const user = authFromToken(header.slice(7));
  if (!user) {
    return res.status(401).json({ error: 'invalid or expired token' });
  }
  req.user = user;
  next();
}

module.exports = { authFromToken, requireAuth };
