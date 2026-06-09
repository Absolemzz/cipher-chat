const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');

const authRouter = require('./routes/auth');
const roomsRouter = require('./routes/rooms');
const usersRouter = require('./routes/users');
const keysRouter = require('./routes/keys');
const logger = require('./logger');
const { recordHttpRequest, register: metricsRegister } = require('./metrics');

const DEFAULT_DEV_ORIGINS = ['http://localhost:3000', 'http://127.0.0.1:3000'];

function parseAllowedOrigins() {
  if (process.env.ALLOWED_ORIGINS) {
    return process.env.ALLOWED_ORIGINS.split(',')
      .map((origin) => origin.trim())
      .filter(Boolean);
  }
  return process.env.NODE_ENV === 'production' ? [] : DEFAULT_DEV_ORIGINS;
}

function parseTrustProxy() {
  const value = process.env.TRUST_PROXY?.trim();
  if (!value) return false;
  if (/^\d+$/.test(value)) return Number(value);
  if (value === 'true') return 1;
  return value;
}

const app = express();
app.set('trust proxy', parseTrustProxy());
app.use((req, res, next) => {
  const providedRequestId = req.header('x-request-id');
  req.id = providedRequestId || crypto.randomUUID();
  req.log = logger.child({ requestId: req.id });
  res.setHeader('x-request-id', req.id);
  next();
});
app.use(
  helmet({
    contentSecurityPolicy: false,
    hsts: false,
  }),
);
app.use(express.json());
app.use(
  cors((req, callback) => {
    const origin = req.header('Origin');
    if (!origin) return callback(null, { origin: false });
    callback(null, { origin: parseAllowedOrigins().includes(origin) });
  }),
);
app.use((req, res, next) => {
  const startedAt = process.hrtime.bigint();
  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    recordHttpRequest(req, res, durationMs);
    req.log.info(
      {
        method: req.method,
        path: req.path,
        route: req.route?.path ? `${req.baseUrl || ''}${req.route.path}` : undefined,
        status: res.statusCode,
        durationMs: Number(durationMs.toFixed(2)),
        userId: req.user?.id,
      },
      'http request completed',
    );
  });
  next();
});

// In-memory rate limiting is acceptable for single-instance/local deployments.
// Multi-instance production deployments require a shared rate-limit store.
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 200 });
app.use(limiter);

app.get('/healthz', (_req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

function requireMetricsAuth(req, res, next) {
  const token = process.env.METRICS_TOKEN;
  if (!token) return next();

  const expected = `Bearer ${token}`;
  if (req.header('Authorization') !== expected) {
    return res.status(401).json({ error: 'missing or invalid metrics token' });
  }
  return next();
}

app.get('/metrics', requireMetricsAuth, async (_req, res, next) => {
  try {
    res.set('Content-Type', metricsRegister.contentType);
    res.end(await metricsRegister.metrics());
  } catch (error) {
    next(error);
  }
});

if (process.env.NODE_ENV === 'test') {
  app.get('/__test__/error', () => {
    throw new Error('synthetic stack leak check');
  });
}

app.use('/auth', authRouter);
app.use('/rooms', roomsRouter);
app.use('/users', usersRouter);
app.use('/keys', keysRouter);

app.use((err, req, res, _next) => {
  const status = err.status || 500;
  const message =
    status >= 500 && process.env.NODE_ENV === 'production'
      ? 'internal server error'
      : err.message || 'internal server error';
  const errorLog = {
    method: req.method,
    path: req.path,
    status,
    userId: req.user?.id,
    err,
  };
  if (status >= 500) {
    req.log?.error(errorLog, 'request failed');
  } else {
    req.log?.warn(errorLog, 'request rejected');
  }
  res.status(status).json({ error: message });
});

module.exports = app;
