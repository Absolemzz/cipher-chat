const {
  handleJoin,
  handlePublicKey,
  handleLeave,
  handleCiphertext
} = require('./roomHandler');

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
      case 'leave':
        handleLeave(msg, ws, user);
        return;
      case 'ciphertext':
        handleCiphertext(msg, ws, user);
        return;
      default:
        return;
    }
  } catch (e) {
    console.error('ws message error', e);
    ws.send(JSON.stringify({ type: 'error', message: 'invalid message' }));
  }
}

module.exports = { handleMessage };