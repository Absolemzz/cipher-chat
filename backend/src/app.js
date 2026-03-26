const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const authRouter = require('./routes/auth');
const roomsRouter = require('./routes/rooms');
const usersRouter = require('./routes/users');
const keysRouter = require('./routes/keys');

const app = express();
app.use(bodyParser.json());
app.use(cors());
app.use(morgan('tiny'));

const limiter = rateLimit({ windowMs: 15*60*1000, max: 200 });
app.use(limiter);

app.use('/auth', authRouter);
app.use('/rooms', roomsRouter);
app.use('/users', usersRouter);
app.use('/keys', keysRouter);

module.exports = app;
