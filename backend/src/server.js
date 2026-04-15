const http = require('http');
const app = require('./app');
const db = require('./db');
const attachWebSocket = require('./websocket/server');

const server = http.createServer(app);
const wss = attachWebSocket(server);

const PORT = process.env.BACKEND_PORT || 4000;
server.listen(PORT, () => {
  console.log(`Backend listening on ${PORT}`);
});

function shutdown(signal) {
  console.log(`${signal} received, shutting down`);

  wss.clients.forEach((ws) => {
    try { ws.close(1001, 'server shutting down'); } catch (_) {}
  });

  server.close(() => {
    db.close();
    console.log('Shutdown complete');
    process.exit(0);
  });

  setTimeout(() => {
    console.error('Forced shutdown after timeout');
    process.exit(1);
  }, 5000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
