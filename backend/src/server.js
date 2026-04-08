const http = require('http');
const app = require('./app');
const attachWebSocket = require('./websocket/server');

const server = http.createServer(app);
attachWebSocket(server);

const PORT = process.env.BACKEND_PORT || 4000;
server.listen(PORT, () => {
  console.log(`Backend listening on ${PORT}`);
});