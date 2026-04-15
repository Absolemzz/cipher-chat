const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_for_demo_only';

function authFromToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
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
