const WebSocket = require('ws');
const { authFromToken } = require('../middleware/auth');
const { handleMessage } = require('./router');
const { handleDisconnect } = require('./roomHandler');

function attachWebSocket(server) {
  const wss = new WebSocket.Server({ server });

  wss.on('connection', (ws, req) => {
    const params = new URLSearchParams(req.url.replace('/?', ''));
    const token = params.get('token');
    const user = authFromToken(token);

    if (!user) {
      ws.send(JSON.stringify({ type: 'error', message: 'unauthenticated' }));
      ws.close();
      return;
    }

    ws._user = user;

    ws.on('message', (raw) => {
      handleMessage(raw, ws, user);
    });

    ws.on('close', () => {
      handleDisconnect(ws);
    });
  });
}

module.exports = attachWebSocket;