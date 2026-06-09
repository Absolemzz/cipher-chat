const pino = require('pino');

const isTest = process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';
const logger = pino({
  level: process.env.LOG_LEVEL || (isTest ? 'silent' : 'info'),
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.body.password',
      'req.body.token',
      'req.body.challenge',
      'req.body.signature',
      'req.body.authPublicKey',
      'req.body.publicKey',
      'req.body.ciphertext',
      'token',
      'password',
      'challenge',
      'signature',
      'authPublicKey',
      'publicKey',
      'ciphertext',
    ],
    remove: true,
  },
});

module.exports = logger;
