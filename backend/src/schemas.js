const { z } = require('zod');

const username = z.string().min(1).max(64).trim();
const uuid = z.string().uuid();
const base64Key = z.string().min(1).max(1024);

const authRegister = z.object({
  body: z.object({
    username,
    publicKey: base64Key.optional(),
    publicKeyHash: z.string().max(256).optional(),
  }),
});

const authLogin = z.object({
  body: z.object({ username }),
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
