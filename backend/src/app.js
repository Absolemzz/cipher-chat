const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const authRouter = require('./routes/auth');
const roomsRouter = require('./routes/rooms');
const usersRouter = require('./routes/users');
const keysRouter = require('./routes/keys');

const app = express();
app.use(express.json());
app.use(cors());
app.use(morgan('tiny'));

const limiter = rateLimit({ windowMs: 15*60*1000, max: 200 });
app.use(limiter);

app.get('/healthz', (_req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

app.use('/auth', authRouter);
app.use('/rooms', roomsRouter);
app.use('/users', usersRouter);
app.use('/keys', keysRouter);

app.use((err, _req, res, _next) => {
  const status = err.status || 500;
  const message = err.message || 'internal server error';
  if (status >= 500) console.error(err);
  res.status(status).json({ error: message });
});

module.exports = app;
