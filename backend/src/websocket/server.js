const WebSocket = require('ws');
const { authFromToken } = require('../middleware/auth');
const { handleMessage } = require('./router');
const { handleDisconnect } = require('./roomHandler');

const MAX_PAYLOAD = 64 * 1024;
const RATE_WINDOW_MS = 1000;
const RATE_MAX_PER_WINDOW = 20;
const AUTH_TIMEOUT_MS = 5000;

function attachWebSocket(server) {
  const wss = new WebSocket.Server({ server, maxPayload: MAX_PAYLOAD });

  wss.on('connection', (ws) => {
    ws._authenticated = false;
    ws._msgTimestamps = [];

    const authTimer = setTimeout(() => {
      if (!ws._authenticated) {
        ws.send(JSON.stringify({ type: 'error', message: 'auth timeout' }));
        ws.close(4001, 'auth timeout');
      }
    }, AUTH_TIMEOUT_MS);

    ws.on('message', (raw) => {
      if (!ws._authenticated) {
        clearTimeout(authTimer);
        try {
          const msg = JSON.parse(raw);
          if (msg.type !== 'auth' || !msg.token) {
            ws.send(JSON.stringify({ type: 'error', message: 'first message must be { type: "auth", token: "..." }' }));
            ws.close(4002, 'auth required');
            return;
          }
          const user = authFromToken(msg.token);
          if (!user) {
            ws.send(JSON.stringify({ type: 'error', message: 'invalid or expired token' }));
            ws.close(4003, 'auth failed');
            return;
          }
          ws._authenticated = true;
          ws._user = user;
          ws.send(JSON.stringify({ type: 'auth_ok', userId: user.id }));
        } catch (e) {
          ws.send(JSON.stringify({ type: 'error', message: 'invalid auth message' }));
          ws.close(4002, 'auth required');
        }
        return;
      }

      const now = Date.now();
      ws._msgTimestamps = ws._msgTimestamps.filter(t => now - t < RATE_WINDOW_MS);
      if (ws._msgTimestamps.length >= RATE_MAX_PER_WINDOW) {
        ws.send(JSON.stringify({ type: 'error', message: 'rate limit exceeded' }));
        return;
      }
      ws._msgTimestamps.push(now);

      handleMessage(raw, ws, ws._user);
    });

    ws.on('close', () => {
      clearTimeout(authTimer);
      handleDisconnect(ws);
    });

    ws.on('error', (err) => {
      console.error('WebSocket client error:', err.message);
    });
  });

  return wss;
}

module.exports = attachWebSocket;