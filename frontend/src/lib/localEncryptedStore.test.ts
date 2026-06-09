import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import {
  LOCAL_CHAT_DB_NAME,
  clearAllLocalChatState,
  clearPeerVerification,
  getPeerVerification,
  isPeerVerifiedForKey,
  loadLocalMessages,
  markPeerVerified,
  readEncryptedRecordsForTest,
  saveLocalMessage,
} from './localEncryptedStore';
import { SAFETY_NUMBER_VERSION, type SafetyNumber } from '../crypto/safety-number';
import type { Message } from '../types';

function deleteDb(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('deleteDatabase blocked'));
  });
}

afterEach(async () => {
  await deleteDb(LOCAL_CHAT_DB_NAME);
});

describe('local encrypted chat store', () => {
  it('round-trips encrypted local messages', async () => {
    const message: Message = {
      id: 'message-1',
      text: 'secret local text',
      from: 'user-1',
      ts: 100,
      status: 'pending',
    };

    await saveLocalMessage('user-1', 'room-1', message);

    const [loaded] = await loadLocalMessages('user-1', 'room-1');
    expect(loaded).toEqual(message);

    const [raw] = await readEncryptedRecordsForTest('user-1', 'room-1');
    expect(raw.ciphertext).not.toContain('secret local text');
  });

  it('uses fresh IVs and ciphertext for repeated writes', async () => {
    const first: Message = { id: 'message-1', text: 'same text', from: 'user-1', ts: 100 };
    const second: Message = { id: 'message-2', text: 'same text', from: 'user-1', ts: 101 };

    await saveLocalMessage('user-1', 'room-1', first);
    await saveLocalMessage('user-1', 'room-1', second);

    const records = await readEncryptedRecordsForTest('user-1', 'room-1');
    expect(records).toHaveLength(2);
    expect(records[0].iv).not.toBe(records[1].iv);
    expect(records[0].ciphertext).not.toBe(records[1].ciphertext);
  });

  it('clears all local chat state for a user', async () => {
    await saveLocalMessage('user-1', 'room-1', {
      id: 'message-1',
      text: 'clear me',
      from: 'user-1',
      ts: 100,
    });

    await clearAllLocalChatState('user-1');

    expect(await loadLocalMessages('user-1', 'room-1')).toEqual([]);
    expect(await readEncryptedRecordsForTest('user-1', 'room-1')).toEqual([]);
  });

  it('persists peer verification for the same peer key', async () => {
    const safetyNumber: SafetyNumber = {
      version: SAFETY_NUMBER_VERSION,
      number: '00001 00002 00003 00004 00005 00006 00007 00008 00009 00010 00011 00012',
      peerKeyFingerprint: 'ABCDEF',
    };

    const saved = await markPeerVerified('user-1', 'room-1', 'peer-1', safetyNumber);

    expect(await getPeerVerification('user-1', 'room-1', 'peer-1')).toEqual(saved);
    expect(await isPeerVerifiedForKey('user-1', 'room-1', 'peer-1', safetyNumber)).toBe(true);
  });

  it('does not apply peer verification after a peer key change', async () => {
    const firstSafetyNumber: SafetyNumber = {
      version: SAFETY_NUMBER_VERSION,
      number: '00001 00002 00003 00004 00005 00006 00007 00008 00009 00010 00011 00012',
      peerKeyFingerprint: 'FIRST',
    };
    const changedSafetyNumber: SafetyNumber = {
      ...firstSafetyNumber,
      peerKeyFingerprint: 'SECOND',
    };

    await markPeerVerified('user-1', 'room-1', 'peer-1', firstSafetyNumber);

    expect(await isPeerVerifiedForKey('user-1', 'room-1', 'peer-1', changedSafetyNumber)).toBe(
      false,
    );

    await clearPeerVerification('user-1', 'room-1', 'peer-1');
    expect(await getPeerVerification('user-1', 'room-1', 'peer-1')).toBeNull();
  });
});
