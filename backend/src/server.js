const http = require('http');
const app = require('./app');
const db = require('./db');
const logger = require('./logger');
const attachWebSocket = require('./websocket/server');

const server = http.createServer(app);
const wss = attachWebSocket(server);

const PORT = process.env.BACKEND_PORT || 4000;
server.listen(PORT, () => {
  logger.info({ port: PORT }, 'backend listening');
});

function shutdown(signal) {
  logger.info({ signal }, 'shutdown requested');

  wss.clients.forEach((ws) => {
    try {
      ws.close(1001, 'server shutting down');
    } catch (_) {}
  });

  server.close(() => {
    db.close();
    logger.info('shutdown complete');
    process.exit(0);
  });

  setTimeout(() => {
    logger.error('forced shutdown after timeout');
    process.exit(1);
  }, 5000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
