const WebSocket = require('ws');
const crypto = require('crypto');
const { authFromToken } = require('../middleware/auth');
const logger = require('../logger');
const { recordWsError, recordWsMessage, wsActiveConnections } = require('../metrics');
const { handleMessage } = require('./router');
const { handleDisconnect, registerConnection } = require('./roomHandler');

const MAX_PAYLOAD = 64 * 1024;
const RATE_WINDOW_MS = 1000;
const RATE_MAX_PER_WINDOW = 20;
const AUTH_TIMEOUT_MS = 5000;

function attachWebSocket(server) {
  const wss = new WebSocket.Server({ server, maxPayload: MAX_PAYLOAD });

  wss.on('connection', (ws) => {
    ws._connectionId = crypto.randomUUID();
    ws._authenticated = false;
    ws._msgTimestamps = [];
    ws._log = logger.child({ wsConnectionId: ws._connectionId });
    wsActiveConnections.inc();
    ws._log.info('websocket connection accepted');

    const originalSend = ws.send.bind(ws);
    ws.send = (data, ...args) => {
      recordWsMessage('sent', messageType(data));
      return originalSend(data, ...args);
    };

    const authTimer = setTimeout(() => {
      if (!ws._authenticated) {
        recordWsError('auth_timeout');
        ws._log.warn('websocket authentication timed out');
        ws.send(JSON.stringify({ type: 'error', message: 'auth timeout' }));
        ws.close(4001, 'auth timeout');
      }
    }, AUTH_TIMEOUT_MS);

    ws.on('message', (raw) => {
      recordWsMessage('received', messageType(raw));
      if (!ws._authenticated) {
        clearTimeout(authTimer);
        try {
          const msg = JSON.parse(raw);
          if (msg.type !== 'auth' || !msg.token) {
            recordWsError('auth_required');
            ws._log.warn({ messageType: msg.type }, 'websocket authentication rejected');
            ws.send(
              JSON.stringify({
                type: 'error',
                message: 'first message must be { type: "auth", token: "..." }',
              }),
            );
            ws.close(4002, 'auth required');
            return;
          }
          const user = authFromToken(msg.token);
          if (!user) {
            recordWsError('auth_failed');
            ws._log.warn('websocket authentication failed');
            ws.send(JSON.stringify({ type: 'error', message: 'invalid or expired token' }));
            ws.close(4003, 'auth failed');
            return;
          }
          ws._authenticated = true;
          ws._user = user;
          registerConnection(ws);
          ws._log = logger.child({ wsConnectionId: ws._connectionId, userId: user.id });
          ws._log.info('websocket authenticated');
          ws.send(JSON.stringify({ type: 'auth_ok', userId: user.id }));
        } catch (e) {
          recordWsError('invalid_auth_message');
          ws._log.warn('websocket invalid auth message');
          ws.send(JSON.stringify({ type: 'error', message: 'invalid auth message' }));
          ws.close(4002, 'auth required');
        }
        return;
      }

      const now = Date.now();
      ws._msgTimestamps = ws._msgTimestamps.filter((t) => now - t < RATE_WINDOW_MS);
      if (ws._msgTimestamps.length >= RATE_MAX_PER_WINDOW) {
        recordWsError('rate_limit');
        ws._log.warn('websocket rate limit exceeded');
        ws.send(JSON.stringify({ type: 'error', message: 'rate limit exceeded' }));
        return;
      }
      ws._msgTimestamps.push(now);

      handleMessage(raw, ws, ws._user);
    });

    ws.on('close', () => {
      clearTimeout(authTimer);
      wsActiveConnections.dec();
      handleDisconnect(ws);
      ws._log.info({ roomJoined: Boolean(ws._roomId) }, 'websocket disconnected');
    });

    ws.on('error', (err) => {
      recordWsError('client_error');
      ws._log.error({ err }, 'websocket client error');
    });
  });

  return wss;
}

function messageType(raw) {
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed.type === 'string' ? parsed.type : 'unknown';
  } catch (_) {
    return 'invalid';
  }
}

module.exports = attachWebSocket;
