const {
  handleJoin,
  handlePublicKey,
  handleCiphertext,
  handleMessageDelivered,
} = require('./roomHandler');
const { recordWsError } = require('../metrics');

function handleMessage(raw, ws, user) {
  try {
    const msg = JSON.parse(raw);

    switch (msg.type) {
      case 'join':
        handleJoin(msg, ws, user);
        return;
      case 'public_key':
        handlePublicKey(msg, ws, user);
        return;
      case 'ciphertext':
        handleCiphertext(msg, ws, user);
        return;
      case 'message.delivered':
        handleMessageDelivered(msg, ws, user);
        return;
      default:
        ws._log?.warn({ messageType: msg.type || 'unknown' }, 'websocket ignored unknown message');
        return;
    }
  } catch (e) {
    recordWsError('invalid_message');
    ws._log?.error({ err: e }, 'websocket message handling failed');
    ws.send(JSON.stringify({ type: 'error', message: 'invalid message' }));
  }
}

module.exports = { handleMessage };
