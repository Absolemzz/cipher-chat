import {
  deserializeRatchetSession,
  serializeRatchetSession,
  type RatchetSession,
  type SerializedRatchetSession,
} from '../crypto/double-ratchet';
import { SAFETY_NUMBER_VERSION, type SafetyNumber } from '../crypto/safety-number';
import type { Message } from '../types';

export const LOCAL_CHAT_DB_NAME = 'cipher-chat-local-v1';
export const LOCAL_CHAT_SCHEMA_VERSION = 1;

type PersistedRecordType =
  | 'message'
  | 'ratchet-session'
  | 'peer-verification'
  | 'outbox-entry'
  | 'pending-ciphertext';

interface EncryptedRecord {
  id: string;
  userId: string;
  roomId: string;
  type: PersistedRecordType;
  iv: string;
  ciphertext: string;
  createdAt: number;
}

interface StoredKey {
  id: string;
  userId: string;
  key: CryptoKey;
}

interface PersistedMessage {
  version: 1;
  message: Message;
}

interface PersistedSession {
  version: 1;
  session: SerializedRatchetSession;
}

export interface PeerVerification {
  version: typeof SAFETY_NUMBER_VERSION;
  userId: string;
  roomId: string;
  peerUserId: string;
  peerKeyFingerprint: string;
  safetyNumber: string;
  verifiedAt: number;
}

interface PersistedPeerVerification {
  version: 1;
  verification: PeerVerification;
}

export interface OutboxEntry {
  version: 1;
  localId: string;
  clientMessageId: string;
  roomId: string;
  plaintext: string;
  ciphertext?: string;
  status: 'pending' | 'sending' | 'sent' | 'failed';
  retryCount: number;
  nextRetryAt: number;
  createdAt: number;
  updatedAt: number;
  lastError?: string;
}

interface PersistedOutboxEntry {
  version: 1;
  entry: OutboxEntry;
}

export interface PendingInboundCiphertext {
  version: 1;
  id: string;
  clientMessageId: string;
  roomId: string;
  from: string;
  ciphertext: string;
  timestamp: number;
}

interface PersistedPendingInbound {
  version: 1;
  pending: PendingInboundCiphertext;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const persistenceKeyPromises = new Map<string, Promise<CryptoKey>>();

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(LOCAL_CHAT_DB_NAME, LOCAL_CHAT_SCHEMA_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('keys')) {
        db.createObjectStore('keys', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('records')) {
        const records = db.createObjectStore('records', { keyPath: 'id' });
        records.createIndex('by_user_room', ['userId', 'roomId'], { unique: false });
        records.createIndex('by_user', 'userId', { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function keyId(userId: string): string {
  return `local-key|${userId}`;
}

function sessionRecordId(userId: string, roomId: string): string {
  return `${userId}|${roomId}|ratchet-session`;
}

function messageRecordId(userId: string, roomId: string, messageId: string): string {
  return `${userId}|${roomId}|message|${messageId}`;
}

function peerVerificationRecordId(userId: string, roomId: string, peerUserId: string): string {
  return `${userId}|${roomId}|peer-verification|${peerUserId}`;
}

function outboxRecordId(userId: string, roomId: string, clientMessageId: string): string {
  return `${userId}|${roomId}|outbox-entry|${clientMessageId}`;
}

function pendingCiphertextRecordId(
  userId: string,
  roomId: string,
  clientMessageId: string,
): string {
  return `${userId}|${roomId}|pending-ciphertext|${clientMessageId}`;
}

function bytes(value: string): Uint8Array<ArrayBuffer> {
  const encoded = encoder.encode(value);
  return new Uint8Array(encoded);
}

function aad(userId: string, roomId: string, type: PersistedRecordType): Uint8Array<ArrayBuffer> {
  return bytes(`cipher-chat-local:${LOCAL_CHAT_SCHEMA_VERSION}:${userId}:${roomId}:${type}`);
}

function bytesFromBufferSource(buf: ArrayBuffer | ArrayBufferView): Uint8Array<ArrayBuffer> {
  if (ArrayBuffer.isView(buf)) {
    const copy = new Uint8Array(new ArrayBuffer(buf.byteLength));
    copy.set(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
    return copy;
  }
  return new Uint8Array(buf.slice(0));
}

function buf2b64(buf: ArrayBuffer | ArrayBufferView): string {
  const u8 = bytesFromBufferSource(buf);
  let binary = '';
  for (const byte of u8) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function b642buf(b64: string): Uint8Array<ArrayBuffer> {
  const raw = atob(b64);
  const buf = new ArrayBuffer(raw.length);
  const view = new Uint8Array(buf);
  for (let i = 0; i < raw.length; i++) view[i] = raw.charCodeAt(i);
  return view;
}

async function loadOrCreatePersistenceKey(userId: string): Promise<CryptoKey> {
  const db = await openDb();
  try {
    const readTransaction = db.transaction('keys', 'readonly');
    const existing = (await requestToPromise(
      readTransaction.objectStore('keys').get(keyId(userId)),
    )) as StoredKey | undefined;
    if (existing?.key) return existing.key;

    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
      'encrypt',
      'decrypt',
    ]);

    const writeTransaction = db.transaction('keys', 'readwrite');
    writeTransaction
      .objectStore('keys')
      .put({ id: keyId(userId), userId, key } satisfies StoredKey);
    await transactionDone(writeTransaction);
    return key;
  } finally {
    db.close();
  }
}

async function getPersistenceKey(userId: string): Promise<CryptoKey> {
  const existingPromise = persistenceKeyPromises.get(userId);
  if (existingPromise) return existingPromise;

  const nextPromise = loadOrCreatePersistenceKey(userId).finally(() => {
    persistenceKeyPromises.delete(userId);
  });
  persistenceKeyPromises.set(userId, nextPromise);
  return nextPromise;
}

async function encryptPayload(
  userId: string,
  roomId: string,
  type: PersistedRecordType,
  payload: unknown,
): Promise<{ ciphertext: string; iv: string }> {
  const key = await getPersistenceKey(userId);
  const iv = new Uint8Array(new ArrayBuffer(12));
  crypto.getRandomValues(iv);
  const plaintext = bytes(JSON.stringify(payload));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: aad(userId, roomId, type) },
    key,
    plaintext,
  );
  return { ciphertext: buf2b64(ciphertext), iv: buf2b64(iv) };
}

async function decryptPayload<T>(
  userId: string,
  roomId: string,
  type: PersistedRecordType,
  record: EncryptedRecord,
): Promise<T> {
  const key = await getPersistenceKey(userId);
  const plaintext = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: b642buf(record.iv),
      additionalData: aad(userId, roomId, type),
    },
    key,
    b642buf(record.ciphertext),
  );
  return JSON.parse(decoder.decode(plaintext)) as T;
}

async function putRecord(record: EncryptedRecord): Promise<void> {
  const db = await openDb();
  try {
    const transaction = db.transaction('records', 'readwrite');
    transaction.objectStore('records').put(record);
    await transactionDone(transaction);
  } finally {
    db.close();
  }
}

export async function saveRatchetSession(
  userId: string,
  roomId: string,
  session: RatchetSession,
): Promise<void> {
  const encrypted = await encryptPayload(userId, roomId, 'ratchet-session', {
    version: 1,
    session: serializeRatchetSession(session),
  } satisfies PersistedSession);
  await putRecord({
    id: sessionRecordId(userId, roomId),
    userId,
    roomId,
    type: 'ratchet-session',
    createdAt: Date.now(),
    ...encrypted,
  });
}

export async function loadRatchetSession(
  userId: string,
  roomId: string,
): Promise<RatchetSession | null> {
  const db = await openDb();
  try {
    const transaction = db.transaction('records', 'readonly');
    const record = (await requestToPromise(
      transaction.objectStore('records').get(sessionRecordId(userId, roomId)),
    )) as EncryptedRecord | undefined;
    if (!record) return null;

    const payload = await decryptPayload<PersistedSession>(
      userId,
      roomId,
      'ratchet-session',
      record,
    );
    if (payload.version !== 1) throw new Error(`unsupported persisted session: ${payload.version}`);
    return deserializeRatchetSession(payload.session);
  } finally {
    db.close();
  }
}

export async function saveLocalMessage(
  userId: string,
  roomId: string,
  message: Message,
): Promise<void> {
  const encrypted = await encryptPayload(userId, roomId, 'message', {
    version: 1,
    message,
  } satisfies PersistedMessage);
  await putRecord({
    id: messageRecordId(userId, roomId, message.id),
    userId,
    roomId,
    type: 'message',
    createdAt: message.ts,
    ...encrypted,
  });
}

export async function loadLocalMessages(userId: string, roomId: string): Promise<Message[]> {
  const db = await openDb();
  try {
    const transaction = db.transaction('records', 'readonly');
    const index = transaction.objectStore('records').index('by_user_room');
    const records = (await requestToPromise(index.getAll([userId, roomId]))) as EncryptedRecord[];
    const messageRecords = records
      .filter((record) => record.type === 'message')
      .sort((a, b) => a.createdAt - b.createdAt);

    const messages = await Promise.all(
      messageRecords.map(async (record) => {
        const payload = await decryptPayload<PersistedMessage>(userId, roomId, 'message', record);
        if (payload.version !== 1) {
          throw new Error(`unsupported persisted message: ${payload.version}`);
        }
        return payload.message;
      }),
    );
    return messages.sort((a, b) => a.ts - b.ts);
  } finally {
    db.close();
  }
}

export async function clearRoomLocalState(userId: string, roomId: string): Promise<void> {
  const db = await openDb();
  try {
    const transaction = db.transaction('records', 'readwrite');
    const index = transaction.objectStore('records').index('by_user_room');
    const records = (await requestToPromise(index.getAll([userId, roomId]))) as EncryptedRecord[];
    for (const record of records) {
      transaction.objectStore('records').delete(record.id);
    }
    await transactionDone(transaction);
  } finally {
    db.close();
  }
}

export async function saveOutboxEntry(userId: string, entry: OutboxEntry): Promise<void> {
  const encrypted = await encryptPayload(userId, entry.roomId, 'outbox-entry', {
    version: 1,
    entry,
  } satisfies PersistedOutboxEntry);
  await putRecord({
    id: outboxRecordId(userId, entry.roomId, entry.clientMessageId),
    userId,
    roomId: entry.roomId,
    type: 'outbox-entry',
    createdAt: entry.createdAt,
    ...encrypted,
  });
}

export async function loadOutboxEntries(userId: string, roomId: string): Promise<OutboxEntry[]> {
  const db = await openDb();
  try {
    const transaction = db.transaction('records', 'readonly');
    const index = transaction.objectStore('records').index('by_user_room');
    const records = (await requestToPromise(index.getAll([userId, roomId]))) as EncryptedRecord[];
    const outboxRecords = records
      .filter((record) => record.type === 'outbox-entry')
      .sort((a, b) => a.createdAt - b.createdAt);

    const entries = await Promise.all(
      outboxRecords.map(async (record) => {
        const payload = await decryptPayload<PersistedOutboxEntry>(
          userId,
          roomId,
          'outbox-entry',
          record,
        );
        if (payload.version !== 1 || payload.entry.version !== 1) {
          throw new Error(`unsupported outbox entry: ${payload.version}`);
        }
        return payload.entry;
      }),
    );
    return entries.sort((a, b) => a.createdAt - b.createdAt);
  } finally {
    db.close();
  }
}

export async function deleteOutboxEntry(
  userId: string,
  roomId: string,
  clientMessageId: string,
): Promise<void> {
  const db = await openDb();
  try {
    const transaction = db.transaction('records', 'readwrite');
    transaction.objectStore('records').delete(outboxRecordId(userId, roomId, clientMessageId));
    await transactionDone(transaction);
  } finally {
    db.close();
  }
}

export async function savePendingInboundCiphertext(
  userId: string,
  pending: PendingInboundCiphertext,
): Promise<void> {
  const encrypted = await encryptPayload(userId, pending.roomId, 'pending-ciphertext', {
    version: 1,
    pending,
  } satisfies PersistedPendingInbound);
  await putRecord({
    id: pendingCiphertextRecordId(userId, pending.roomId, pending.clientMessageId),
    userId,
    roomId: pending.roomId,
    type: 'pending-ciphertext',
    createdAt: pending.timestamp,
    ...encrypted,
  });
}

export async function loadPendingInboundCiphertexts(
  userId: string,
  roomId: string,
): Promise<PendingInboundCiphertext[]> {
  const db = await openDb();
  try {
    const transaction = db.transaction('records', 'readonly');
    const index = transaction.objectStore('records').index('by_user_room');
    const records = (await requestToPromise(index.getAll([userId, roomId]))) as EncryptedRecord[];
    const pendingRecords = records
      .filter((record) => record.type === 'pending-ciphertext')
      .sort((a, b) => a.createdAt - b.createdAt);

    const pending = await Promise.all(
      pendingRecords.map(async (record) => {
        const payload = await decryptPayload<PersistedPendingInbound>(
          userId,
          roomId,
          'pending-ciphertext',
          record,
        );
        if (payload.version !== 1 || payload.pending.version !== 1) {
          throw new Error(`unsupported pending ciphertext: ${payload.version}`);
        }
        return payload.pending;
      }),
    );
    return pending.sort((a, b) => a.timestamp - b.timestamp);
  } finally {
    db.close();
  }
}

export async function deletePendingInboundCiphertext(
  userId: string,
  roomId: string,
  clientMessageId: string,
): Promise<void> {
  const db = await openDb();
  try {
    const transaction = db.transaction('records', 'readwrite');
    transaction
      .objectStore('records')
      .delete(pendingCiphertextRecordId(userId, roomId, clientMessageId));
    await transactionDone(transaction);
  } finally {
    db.close();
  }
}

export async function getPeerVerification(
  userId: string,
  roomId: string,
  peerUserId: string,
): Promise<PeerVerification | null> {
  const db = await openDb();
  try {
    const transaction = db.transaction('records', 'readonly');
    const record = (await requestToPromise(
      transaction.objectStore('records').get(peerVerificationRecordId(userId, roomId, peerUserId)),
    )) as EncryptedRecord | undefined;
    if (!record) return null;

    const payload = await decryptPayload<PersistedPeerVerification>(
      userId,
      roomId,
      'peer-verification',
      record,
    );
    if (payload.version !== 1) {
      throw new Error(`unsupported peer verification: ${payload.version}`);
    }
    return payload.verification;
  } finally {
    db.close();
  }
}

export async function markPeerVerified(
  userId: string,
  roomId: string,
  peerUserId: string,
  safetyNumber: SafetyNumber,
): Promise<PeerVerification> {
  const verification: PeerVerification = {
    version: safetyNumber.version,
    userId,
    roomId,
    peerUserId,
    peerKeyFingerprint: safetyNumber.peerKeyFingerprint,
    safetyNumber: safetyNumber.number,
    verifiedAt: Date.now(),
  };
  const encrypted = await encryptPayload(userId, roomId, 'peer-verification', {
    version: 1,
    verification,
  } satisfies PersistedPeerVerification);
  await putRecord({
    id: peerVerificationRecordId(userId, roomId, peerUserId),
    userId,
    roomId,
    type: 'peer-verification',
    createdAt: verification.verifiedAt,
    ...encrypted,
  });
  return verification;
}

export async function clearPeerVerification(
  userId: string,
  roomId: string,
  peerUserId: string,
): Promise<void> {
  const db = await openDb();
  try {
    const transaction = db.transaction('records', 'readwrite');
    transaction.objectStore('records').delete(peerVerificationRecordId(userId, roomId, peerUserId));
    await transactionDone(transaction);
  } finally {
    db.close();
  }
}

export async function isPeerVerifiedForKey(
  userId: string,
  roomId: string,
  peerUserId: string,
  safetyNumber: SafetyNumber,
): Promise<boolean> {
  const verification = await getPeerVerification(userId, roomId, peerUserId);
  return (
    verification?.version === safetyNumber.version &&
    verification.peerKeyFingerprint === safetyNumber.peerKeyFingerprint
  );
}

export async function clearAllLocalChatState(userId: string): Promise<void> {
  const db = await openDb();
  try {
    const transaction = db.transaction(['keys', 'records'], 'readwrite');
    const recordsStore = transaction.objectStore('records');
    const index = recordsStore.index('by_user');
    const records = (await requestToPromise(index.getAll(userId))) as EncryptedRecord[];
    for (const record of records) {
      recordsStore.delete(record.id);
    }
    transaction.objectStore('keys').delete(keyId(userId));
    await transactionDone(transaction);
  } finally {
    db.close();
  }
}

export async function readEncryptedRecordsForTest(
  userId: string,
  roomId: string,
): Promise<EncryptedRecord[]> {
  const db = await openDb();
  try {
    const transaction = db.transaction('records', 'readonly');
    const index = transaction.objectStore('records').index('by_user_room');
    return (await requestToPromise(index.getAll([userId, roomId]))) as EncryptedRecord[];
  } finally {
    db.close();
  }
}
