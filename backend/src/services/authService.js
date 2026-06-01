const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const argon2 = require('argon2');
const User = require('../models/User');
const AuthChallenge = require('../models/AuthChallenge');

const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

function getJwtSecret() {
  if (!process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET is required');
  }
  return process.env.JWT_SECRET;
}

function httpError(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function makeChallengeText({ purpose, username, challengeId, nonce }) {
  return `cipher-chat-auth-v1:${purpose}:${username}:${challengeId}:${nonce}`;
}

function signToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username },
    getJwtSecret(),
    { expiresIn: '7d' }
  );
}

function passwordInput(password) {
  return `${password}${process.env.PASSWORD_PEPPER || ''}`;
}

async function hashPassword(password) {
  return argon2.hash(passwordInput(password), ARGON2_OPTIONS);
}

async function verifyPassword(passwordHash, password) {
  try {
    return await argon2.verify(passwordHash, passwordInput(password));
  } catch (_) {
    return false;
  }
}

function verifyChallengeSignature(authPublicKey, challenge, signature) {
  try {
    const key = crypto.createPublicKey({
      key: Buffer.from(authPublicKey, 'base64'),
      format: 'der',
      type: 'spki',
    });
    const data = Buffer.from(challenge, 'utf8');
    const sig = Buffer.from(signature, 'base64');

    return crypto.verify('sha256', data, key, sig) ||
      crypto.verify('sha256', data, { key, dsaEncoding: 'ieee-p1363' }, sig);
  } catch (_) {
    return false;
  }
}

function getUsableChallenge({ challengeId, username, purpose }) {
  const row = AuthChallenge.findById(challengeId);
  if (!row) throw httpError('challenge not found', 400);
  if (row.username !== username || row.purpose !== purpose) {
    throw httpError('challenge does not match request', 400);
  }
  if (row.used_at) throw httpError('challenge already used', 400);
  if (row.expires_at < Date.now()) throw httpError('challenge expired', 400);
  return row;
}

async function createChallenge({ username, purpose, authPublicKey }) {
  if (!username) throw httpError('Username is required', 400);

  AuthChallenge.deleteExpired(Date.now());

  const existingUser = User.findByUsername(username);
  if (purpose === 'register') {
    if (existingUser) throw httpError('Username already taken', 409);
    if (!authPublicKey) throw httpError('authPublicKey is required for registration', 400);
  }

  if (purpose === 'login') {
    if (!existingUser) throw httpError('User not found', 404);
    if (!existingUser.auth_public_key) {
      throw httpError('account is missing an authentication key', 409);
    }
  }

  const challengeId = crypto.randomUUID();
  const nonce = crypto.randomBytes(32).toString('base64url');
  const challenge = makeChallengeText({ purpose, username, challengeId, nonce });
  const expiresAt = Date.now() + CHALLENGE_TTL_MS;

  AuthChallenge.create({
    id: challengeId,
    username,
    purpose,
    authPublicKey: purpose === 'register' ? authPublicKey : existingUser.auth_public_key,
    nonce,
    challenge,
    expiresAt,
  });

  return { challengeId, nonce, challenge, expiresAt };
}

async function register({ username, password, authPublicKey, challengeId, signature, publicKey }) {
  if (!username) throw httpError('Username is required', 400);
  if (!password) throw httpError('Password is required', 400);

  if (User.findByUsername(username)) {
    throw httpError('Username already taken', 409);
  }

  const challenge = getUsableChallenge({ challengeId, username, purpose: 'register' });
  if (challenge.auth_public_key !== authPublicKey) {
    throw httpError('challenge key does not match registration key', 400);
  }
  if (!verifyChallengeSignature(authPublicKey, challenge.challenge, signature)) {
    throw httpError('invalid challenge signature', 401);
  }
  const consumed = AuthChallenge.markUsed(challengeId, Date.now());
  if (consumed.changes !== 1) {
    throw httpError('challenge already used', 400);
  }

  const id = crypto.randomUUID();
  const passwordHash = await hashPassword(password);
  const newUser = User.create({ id, username, passwordHash, publicKey, authPublicKey });
  const token = signToken(newUser);

  return { id: newUser.id, username: newUser.username, token };
}

async function login({ username, password, challengeId, signature }) {
  if (!username) throw httpError('Username is required', 400);
  if (!password) throw httpError('Password is required', 400);

  const user = User.findByUsername(username);
  if (!user) throw httpError('invalid username or password', 401);
  if (!user.auth_public_key) throw httpError('account is missing an authentication key', 409);

  const challenge = getUsableChallenge({ challengeId, username, purpose: 'login' });
  if (!verifyChallengeSignature(user.auth_public_key, challenge.challenge, signature)) {
    throw httpError('invalid challenge signature', 401);
  }
  const consumed = AuthChallenge.markUsed(challengeId, Date.now());
  if (consumed.changes !== 1) {
    throw httpError('challenge already used', 400);
  }
  if (!user.password_hash) throw httpError('account is missing a password hash', 409);
  if (!await verifyPassword(user.password_hash, password)) {
    throw httpError('invalid username or password', 401);
  }

  const token = signToken(user);
  return { id: user.id, username: user.username, token };
}

module.exports = {
  createChallenge,
  register,
  login
};