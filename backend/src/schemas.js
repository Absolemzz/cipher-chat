const { z } = require('zod');

const username = z.string().min(1).max(64).trim();
const password = z.string().min(12).max(256);
const uuid = z.string().uuid();
const base64Key = z.string().min(1).max(1024);
const authPublicKey = z.string().min(1).max(2048);
const signature = z.string().min(1).max(512);

const authChallenge = z.object({
  body: z.object({
    username,
    purpose: z.enum(['register', 'login']),
    authPublicKey: authPublicKey.optional(),
  }),
});

const authRegister = z.object({
  body: z.object({
    username,
    password,
    authPublicKey,
    challengeId: uuid,
    signature,
    publicKey: base64Key.optional(),
  }),
});

const authLogin = z.object({
  body: z.object({
    username,
    password,
    challengeId: uuid,
    signature,
  }),
});

const keysPublish = z.object({
  body: z.object({
    userId: uuid,
    publicKey: base64Key,
  }),
});

const keysGetLog = z.object({
  params: z.object({ userId: uuid }),
});

const userIdParam = z.object({
  params: z.object({ userId: uuid }),
});

const userRoomParams = z.object({
  params: z.object({
    userId: uuid,
    roomId: uuid,
  }),
});

const roomCodeParam = z.object({
  params: z.object({ code: z.string().min(1).max(128) }),
});

const roomMessagesParam = z.object({
  params: z.object({ roomId: uuid }),
});

const publicKeyParam = z.object({
  params: z.object({ userId: uuid }),
});

module.exports = {
  authChallenge,
  authRegister,
  authLogin,
  keysPublish,
  keysGetLog,
  userIdParam,
  userRoomParams,
  roomCodeParam,
  roomMessagesParam,
  publicKeyParam,
};
