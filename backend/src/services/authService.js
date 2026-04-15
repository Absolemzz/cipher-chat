const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const User = require('../models/User');

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_for_demo_only';

async function register({ username, publicKey, publicKeyHash }) {
  if (!username) {
    const error = new Error('Username is required');
    error.status = 400; 
    throw error;
  }

  if (User.findByUsername(username)) {
    const error = new Error('Username already taken');
    error.status = 409;
    throw error;
  }

  const id = uuidv4();
  const newUser = User.create({ id, username, publicKey, publicKeyHash });

  const token = jwt.sign(
    { id: newUser.id, username: newUser.username }, 
    JWT_SECRET, 
    { expiresIn: '7d' }
  );

  return { id: newUser.id, username: newUser.username, token };
}

async function login(username) {
  if (!username) {
    const error = new Error('Username is required');
    error.status = 400;
    throw error;
  }

  // Fetch from the database via the Model
  const user = User.findByUsername(username);

  if (!user) {
    const error = new Error('User not found');
    error.status = 404;
    throw error;
  }

  // Generate the token
  const token = jwt.sign(
    { id: user.id, username: user.username }, 
    JWT_SECRET, 
    { expiresIn: '7d' }
  );

  return { id: user.id, username: user.username, token };
}

module.exports = {
  register,
  login
};