import { useCallback, useEffect, useRef, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { ensureKeys, getPublicKey, initDoubleRatchet } from '../crypto/crypto';
import { ratchetDecrypt, ratchetEncrypt, type RatchetSession } from '../crypto/double-ratchet';
import {
  deleteOutboxEntry,
  deletePendingInboundCiphertext,
  loadLocalMessages,
  loadOutboxEntries,
  loadPendingInboundCiphertexts,
  loadRatchetSession,
  saveLocalMessage,
  saveOutboxEntry,
  savePendingInboundCiphertext,
  saveRatchetSession,
  type OutboxEntry,
  type PendingInboundCiphertext,
} from '../lib/localEncryptedStore';
import { getWebSocketUrl } from '../lib/transport';
import type { Message, User, WsClientMessage } from '../types';

/**
 * Minimal structural view of the Web Locks API. Declared locally so the lock
 * primitive does not depend on a specific TS DOM lib version and degrades
 * gracefully where the API is absent (e.g. jsdom under test).
 */
interface WebLockManager {
  request: <T>(name: string, callback: () => Promise<T>) => Promise<T>;
}

export type ChatConnectionState =
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected'
  | 'error';

interface UseLiveRatchetChatArgs {
  auditPeerKey: (peerId: string, currentKey: string) => Promise<void>;
  selectedRoomId: string | undefined;
  setKeyWarning: (warning: string | null) => void;
  user: User;
}

const RECONNECT_BASE_DELAY_MS = 250;
const RECONNECT_MAX_DELAY_MS = 4000;
const RECONNECT_MAX_ATTEMPTS = 5;
const OUTBOX_BASE_RETRY_MS = 250;
const OUTBOX_MAX_RETRY_MS = 2000;
const OUTBOX_MAX_SEND_ATTEMPTS = 3;
const DEBUG_CHAT = import.meta.env.VITE_DEBUG_CHAT === 'true';

export function useLiveRatchetChat({
  auditPeerKey,
  selectedRoomId,
  setKeyWarning,
  user,
}: UseLiveRatchetChatArgs) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState('');
  const [recipientPublicKey, setRecipientPublicKey] = useState<string | null>(null);
  const [peerIdentity, setPeerIdentity] = useState<{ userId: string; publicKey: string } | null>(
    null,
  );
  const [sessionReady, setSessionReady] = useState(false);
  const [connectionState, setConnectionState] = useState<ChatConnectionState>('disconnected');
  const wsRef = useRef<WebSocket | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const ratchetSessionRef = useRef<RatchetSession | null>(null);
  const peerIdentityRef = useRef<{ userId: string; publicKey: string } | null>(null);
  const selectedRoomIdRef = useRef<string | undefined>(selectedRoomId);
  const sessionReadyRef = useRef(false);
  const connectionStateRef = useRef<ChatConnectionState>('disconnected');
  const socketGenerationRef = useRef(0);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const outboxFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const outboxFlushInProgressRef = useRef(false);
  const outboxFlushRef = useRef<() => Promise<void>>(async () => {});
  const outboxRef = useRef<Map<string, OutboxEntry>>(new Map());
  const inboundMessageKeysRef = useRef<Set<string>>(new Set());
  const pendingCiphertextRef = useRef<Extract<WsClientMessage, { type: 'ciphertext' }>[]>([]);
  const roomStateLoadedRef = useRef(false);
  const ratchetMutexRef = useRef<Promise<unknown>>(Promise.resolve());

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const clearOutboxFlushTimer = useCallback(() => {
    if (outboxFlushTimerRef.current) {
      clearTimeout(outboxFlushTimerRef.current);
      outboxFlushTimerRef.current = null;
    }
  }, []);

  const scheduleOutboxFlush = useCallback(
    (delayMs = 0) => {
      clearOutboxFlushTimer();
      outboxFlushTimerRef.current = setTimeout(() => {
        outboxFlushTimerRef.current = null;
        void outboxFlushRef.current();
      }, delayMs);
    },
    [clearOutboxFlushTimer],
  );

  // Serializes every ratchet state transition (encrypt, live decrypt, queued
  // drain). The Web Locks API extends this exclusion across same-origin tabs so
  // two tabs of the same user cannot interleave and corrupt the shared session;
  // an in-process promise chain is used where the API is unavailable.
  const withRatchetLock = useCallback(
    <T>(roomId: string, op: () => Promise<T>): Promise<T> => {
      const lockManager =
        typeof navigator !== 'undefined'
          ? (navigator as unknown as { locks?: WebLockManager }).locks
          : undefined;
      if (lockManager?.request) {
        return lockManager.request(`cipher-chat:ratchet:${user.id}:${roomId}`, () => op());
      }
      const result = ratchetMutexRef.current.then(op, op);
      ratchetMutexRef.current = result.then(
        () => undefined,
        () => undefined,
      );
      return result as Promise<T>;
    },
    [user.id],
  );

  useEffect(() => {
    selectedRoomIdRef.current = selectedRoomId;
  }, [selectedRoomId]);

  useEffect(() => {
    sessionReadyRef.current = sessionReady;
  }, [sessionReady]);

  useEffect(() => {
    connectionStateRef.current = connectionState;
  }, [connectionState]);

  useEffect(() => {
    peerIdentityRef.current = peerIdentity;
  }, [peerIdentity]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const upsertDisplayedMessage = useCallback((roomId: string, message: Message) => {
    if (selectedRoomIdRef.current !== roomId) return;

    setMessages((prev) => {
      const existingIndex = prev.findIndex((m) => m.id === message.id);
      if (existingIndex === -1) {
        return [...prev, message].sort((a, b) => a.ts - b.ts);
      }

      const updated = [...prev];
      updated[existingIndex] = { ...updated[existingIndex], ...message };
      return updated.sort((a, b) => a.ts - b.ts);
    });
  }, []);

  const persistOutboxEntry = useCallback(
    async (entry: OutboxEntry) => {
      outboxRef.current.set(outboxKey(entry.roomId, entry.clientMessageId), entry);
      const message = outboxEntryToMessage(entry, user.id);
      upsertDisplayedMessage(entry.roomId, message);

      try {
        await Promise.all([
          saveOutboxEntry(user.id, entry),
          saveLocalMessage(user.id, entry.roomId, message),
        ]);
      } catch (e) {
        console.warn('failed to persist outbox entry', e);
      }
    },
    [upsertDisplayedMessage, user.id],
  );

  const removeOutboxEntry = useCallback(
    async (roomId: string, clientMessageId: string) => {
      outboxRef.current.delete(outboxKey(roomId, clientMessageId));
      try {
        await deleteOutboxEntry(user.id, roomId, clientMessageId);
      } catch (e) {
        console.warn('failed to delete outbox entry', e);
      }
    },
    [user.id],
  );

  const markOutboxFailed = useCallback(
    async (entry: OutboxEntry, reason: string) => {
      chatDebug(
        'outbox.failed',
        outboxTrace(entry, selectedRoomIdRef.current, {
          reason,
          socketGeneration: socketGenerationRef.current,
        }),
      );
      await persistOutboxEntry({
        ...entry,
        status: 'failed',
        updatedAt: Date.now(),
        lastError: reason,
      });
    },
    [persistOutboxEntry],
  );

  const markRoomOutboxPending = useCallback(
    async (roomId: string) => {
      const entries = [...outboxRef.current.values()].filter(
        (entry) => entry.roomId === roomId && entry.status === 'sending',
      );
      for (const entry of entries) {
        chatDebug(
          'outbox.sending_reset',
          outboxTrace(entry, selectedRoomIdRef.current, {
            socketGeneration: socketGenerationRef.current,
          }),
        );
        await persistOutboxEntry({
          ...entry,
          status: 'pending',
          nextRetryAt: 0,
          updatedAt: Date.now(),
        });
      }
    },
    [persistOutboxEntry],
  );

  const markOutboxSent = useCallback(
    async (roomId: string, clientMessageId: string, relayTargetCount: number | undefined) => {
      const entry = outboxRef.current.get(outboxKey(roomId, clientMessageId));
      if (!entry || entry.status === 'failed') return;

      if (relayTargetCount === 0) {
        chatDebug(
          'outbox.sent_offline',
          outboxTrace(entry, selectedRoomIdRef.current, {
            relayTargetCount,
            socketGeneration: socketGenerationRef.current,
          }),
        );
      }

      chatDebug(
        'outbox.sent',
        outboxTrace(entry, selectedRoomIdRef.current, {
          relayTargetCount,
          socketGeneration: socketGenerationRef.current,
        }),
      );
      await persistOutboxEntry({
        ...entry,
        status: 'sent',
        updatedAt: Date.now(),
        lastError: undefined,
      });
    },
    [persistOutboxEntry],
  );

  const isRoomReadyToFlush = useCallback(
    (roomId: string, socket: WebSocket | null, generation: number): socket is WebSocket =>
      Boolean(
        selectedRoomIdRef.current === roomId &&
        socket &&
        socket.readyState === WebSocket.OPEN &&
        connectionStateRef.current === 'connected' &&
        socketGenerationRef.current === generation &&
        sessionReadyRef.current &&
        ratchetSessionRef.current &&
        peerIdentityRef.current?.publicKey,
      ),
    [],
  );

  const flushOutbox = useCallback(async () => {
    if (outboxFlushInProgressRef.current) return;

    const roomId = selectedRoomIdRef.current;
    const socket = wsRef.current;
    const generation = socketGenerationRef.current;
    if (!roomId || !isRoomReadyToFlush(roomId, socket, generation)) {
      chatDebug('outbox.flush_not_ready', {
        roomId,
        selectedRoomId: selectedRoomIdRef.current,
        socketGeneration: generation,
        connectionState: connectionStateRef.current,
        joinReady: connectionStateRef.current === 'connected',
        ratchetReady: Boolean(sessionReadyRef.current && ratchetSessionRef.current),
      });
      return;
    }

    outboxFlushInProgressRef.current = true;
    try {
      const now = Date.now();
      const dueEntries = [...outboxRef.current.values()]
        .filter(
          (entry) =>
            entry.roomId === roomId &&
            (entry.status === 'pending' || entry.status === 'sending') &&
            entry.nextRetryAt <= now,
        )
        .sort((a, b) => a.createdAt - b.createdAt);

      for (const currentEntry of dueEntries) {
        const latestEntry =
          outboxRef.current.get(outboxKey(currentEntry.roomId, currentEntry.clientMessageId)) ??
          currentEntry;

        chatDebug(
          'outbox.flush_entry',
          outboxTrace(latestEntry, selectedRoomIdRef.current, {
            socketGeneration: generation,
            connectionState: connectionStateRef.current,
            joinReady: connectionStateRef.current === 'connected',
            ratchetReady: Boolean(sessionReadyRef.current && ratchetSessionRef.current),
          }),
        );

        if (latestEntry.status === 'failed') continue;
        if (latestEntry.retryCount >= OUTBOX_MAX_SEND_ATTEMPTS) {
          await markOutboxFailed(latestEntry, 'Message was not acknowledged after retries.');
          continue;
        }
        if (!isRoomReadyToFlush(latestEntry.roomId, wsRef.current, generation)) break;

        let entry: OutboxEntry = {
          ...latestEntry,
          status: 'sending',
          updatedAt: Date.now(),
        };
        await persistOutboxEntry(entry);

        if (!entry.ciphertext) {
          const currentSession = ratchetSessionRef.current;
          if (!currentSession) break;

          try {
            // Encrypt + advance + persist atomically under the ratchet lock so an
            // interleaved decrypt cannot clobber the sending chain (which would
            // reuse a message number and make the peer drop the next message).
            const encrypted = await withRatchetLock(entry.roomId, async () => {
              const session = (await loadRatchetSession(user.id, entry.roomId)) ?? currentSession;
              const result = await ratchetEncrypt(session, entry.plaintext);
              await saveRatchetSession(user.id, entry.roomId, result.session);
              if (
                selectedRoomIdRef.current === entry.roomId &&
                socketGenerationRef.current === generation
              ) {
                ratchetSessionRef.current = result.session;
              }
              return result;
            });
            entry = {
              ...entry,
              ciphertext: encrypted.ciphertext,
              updatedAt: Date.now(),
            };
            chatDebug(
              'outbox.encrypted',
              outboxTrace(entry, selectedRoomIdRef.current, {
                encrypted: true,
                socketGeneration: generation,
              }),
            );
            await persistOutboxEntry(entry);
          } catch (e) {
            console.warn('[ChatRoom] encrypt failed', e);
            await markOutboxFailed(entry, 'Encryption failed.');
            continue;
          }
        }

        const activeSocket = wsRef.current;
        if (!entry.ciphertext || !isRoomReadyToFlush(entry.roomId, activeSocket, generation)) {
          await persistOutboxEntry({
            ...entry,
            status: 'pending',
            nextRetryAt: 0,
            updatedAt: Date.now(),
          });
          break;
        }

        const attempt = entry.retryCount + 1;
        entry = {
          ...entry,
          status: 'sending',
          retryCount: attempt,
          nextRetryAt: Date.now() + outboxRetryDelay(attempt),
          updatedAt: Date.now(),
          lastError: undefined,
        };
        await persistOutboxEntry(entry);

        const payload = {
          type: 'ciphertext',
          id: entry.clientMessageId,
          clientMessageId: entry.clientMessageId,
          roomId: entry.roomId,
          ciphertext: entry.ciphertext,
          timestamp: entry.createdAt,
        };

        try {
          activeSocket.send(JSON.stringify(payload));
          chatDebug(
            'outbox.socket_send',
            outboxTrace(entry, selectedRoomIdRef.current, {
              socketSend: true,
              socketGeneration: generation,
            }),
          );
        } catch (e) {
          console.warn('[ChatRoom] send failed', e);
          if (attempt >= OUTBOX_MAX_SEND_ATTEMPTS) {
            await markOutboxFailed(
              { ...entry, retryCount: attempt, updatedAt: Date.now() },
              'Message could not be sent.',
            );
            continue;
          }
          await persistOutboxEntry({
            ...entry,
            status: 'pending',
            retryCount: attempt,
            nextRetryAt: Date.now() + outboxRetryDelay(attempt),
            updatedAt: Date.now(),
            lastError: 'Message could not be sent.',
          });
        }
      }
    } finally {
      outboxFlushInProgressRef.current = false;
      const nextDueAt = nextDueOutboxTimestamp(selectedRoomIdRef.current, outboxRef.current);
      if (nextDueAt !== null) {
        scheduleOutboxFlush(Math.max(0, nextDueAt - Date.now()));
      }
    }
  }, [
    isRoomReadyToFlush,
    markOutboxFailed,
    persistOutboxEntry,
    scheduleOutboxFlush,
    user.id,
    withRatchetLock,
  ]);

  useEffect(() => {
    outboxFlushRef.current = flushOutbox;
  }, [flushOutbox]);

  useEffect(() => {
    if (!recipientPublicKey || !roomStateLoadedRef.current) return;
    if (ratchetSessionRef.current) {
      setSessionReady(true);
      scheduleOutboxFlush(0);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const session = await initDoubleRatchet(user.username, recipientPublicKey);
        if (cancelled) return;
        ratchetSessionRef.current = session;
        if (selectedRoomId) {
          await saveRatchetSession(user.id, selectedRoomId, session);
        }
        setSessionReady(true);
        scheduleOutboxFlush(0);
      } catch (e) {
        console.warn('[ChatRoom] initDoubleRatchet failed', e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [recipientPublicKey, scheduleOutboxFlush, selectedRoomId, user.id, user.username]);

  const sendRecipientDeliveryAck = useCallback((roomId: string, clientMessageId: string) => {
    const socket = wsRef.current;
    if (
      connectionStateRef.current !== 'connected' ||
      !socket ||
      socket.readyState !== WebSocket.OPEN
    ) {
      chatDebug('recipient.delivery_ack_skipped', {
        clientMessageId,
        roomId,
        selectedRoomId: selectedRoomIdRef.current,
        socketGeneration: socketGenerationRef.current,
        connectionState: connectionStateRef.current,
      });
      return;
    }

    socket.send(
      JSON.stringify({
        type: 'message.delivered',
        roomId,
        clientMessageId,
      }),
    );
    chatDebug('recipient.delivery_ack_sent', {
      clientMessageId,
      roomId,
      selectedRoomId: selectedRoomIdRef.current,
      socketGeneration: socketGenerationRef.current,
    });
  }, []);

  const queueInboundCiphertext = useCallback(
    async (msg: Extract<WsClientMessage, { type: 'ciphertext' }>, messageRoomId: string) => {
      const clientMessageId = msg.clientMessageId ?? msg.id;
      const pending: PendingInboundCiphertext = {
        version: 1,
        id: msg.id,
        clientMessageId,
        roomId: messageRoomId,
        from: msg.from,
        ciphertext: msg.ciphertext,
        timestamp: msg.timestamp,
      };
      chatDebug('recipient.queued_for_room', {
        clientMessageId,
        roomId: messageRoomId,
        selectedRoomId: selectedRoomIdRef.current,
        socketGeneration: socketGenerationRef.current,
      });
      try {
        await savePendingInboundCiphertext(user.id, pending);
      } catch (e) {
        console.warn('failed to queue inbound ciphertext', e);
      }
    },
    [user.id],
  );

  const decryptCiphertextMsg = useCallback(
    async (msg: Extract<WsClientMessage, { type: 'ciphertext' }>) => {
      const messageRoomId = msg.roomId ?? selectedRoomIdRef.current;
      const clientMessageId = msg.clientMessageId ?? msg.id;
      if (!messageRoomId) return;

      chatDebug('recipient.ciphertext_received', {
        clientMessageId,
        roomId: messageRoomId,
        selectedRoomId: selectedRoomIdRef.current,
        socketGeneration: socketGenerationRef.current,
      });

      const renderedKey = inboundMessageKey(messageRoomId, msg.from, clientMessageId);

      // The dedupe check, decrypt, and session advance happen as one atomic step
      // under the ratchet lock. This keeps decryption idempotent and prevents an
      // overlapping encrypt/decrypt (or a second tab) from racing the session.
      const outcome = await withRatchetLock(
        messageRoomId,
        async (): Promise<{ kind: 'duplicate' } | { kind: 'decrypted'; plaintext: string }> => {
          if (inboundMessageKeysRef.current.has(renderedKey)) {
            return { kind: 'duplicate' };
          }

          const session =
            (await loadRatchetSession(user.id, messageRoomId)) ?? ratchetSessionRef.current;
          if (!session) throw new Error('[ChatRoom] decrypt: ratchet session not ready');

          let decrypted: { plaintext: string; session: RatchetSession };
          try {
            decrypted = await ratchetDecrypt(session, msg.ciphertext);
          } catch (e) {
            chatDebug('recipient.decrypt_failed', {
              clientMessageId,
              roomId: messageRoomId,
              senderUserId: msg.from,
              socketGeneration: socketGenerationRef.current,
            });
            throw e;
          }

          // Persist the advanced session before marking the message rendered so a
          // failed write cannot leave the ratchet ahead of durable state.
          await saveRatchetSession(user.id, messageRoomId, decrypted.session);
          inboundMessageKeysRef.current.add(renderedKey);
          if (selectedRoomIdRef.current === messageRoomId) {
            ratchetSessionRef.current = decrypted.session;
          }
          return { kind: 'decrypted', plaintext: decrypted.plaintext };
        },
      );

      if (outcome.kind === 'duplicate') {
        chatDebug('recipient.duplicate_ignored', {
          clientMessageId,
          roomId: messageRoomId,
          senderUserId: msg.from,
          socketGeneration: socketGenerationRef.current,
        });
        try {
          await deletePendingInboundCiphertext(user.id, messageRoomId, clientMessageId);
        } catch (e) {
          console.warn('failed to drop duplicate pending ciphertext', e);
        }
        sendRecipientDeliveryAck(messageRoomId, clientMessageId);
        return;
      }

      chatDebug('recipient.decrypt_succeeded', {
        clientMessageId,
        roomId: messageRoomId,
        senderUserId: msg.from,
        socketGeneration: socketGenerationRef.current,
      });

      const message = {
        id: msg.id,
        text: outcome.plaintext,
        from: msg.from,
        ts: msg.timestamp,
      };
      if (selectedRoomIdRef.current === messageRoomId) {
        setMessages((prev) => {
          if (prev.some((existing) => existing.id === message.id && existing.from === message.from)) {
            return prev;
          }
          return [...prev, message];
        });
      }
      chatDebug('recipient.rendered', {
        clientMessageId,
        roomId: messageRoomId,
        senderUserId: msg.from,
        socketGeneration: socketGenerationRef.current,
      });
      try {
        await saveLocalMessage(user.id, messageRoomId, message);
        await deletePendingInboundCiphertext(user.id, messageRoomId, clientMessageId);
      } catch (e) {
        console.warn('failed to persist inbound message', e);
      }
      sendRecipientDeliveryAck(messageRoomId, clientMessageId);
    },
    [sendRecipientDeliveryAck, user.id, withRatchetLock],
  );

  useEffect(() => {
    if (!selectedRoomId || !sessionReady || !ratchetSessionRef.current) return;

    let cancelled = false;
    (async () => {
      const pending = pendingCiphertextRef.current;
      pendingCiphertextRef.current = [];
      for (const p of pending) {
        if (cancelled) return;
        try {
          await decryptCiphertextMsg(p);
        } catch (e) {
          console.warn('decrypt failed', e);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedRoomId, sessionReady, decryptCiphertextMsg]);

  useEffect(() => {
    if (!selectedRoomId) {
      setConnectionState('disconnected');
      return;
    }

    let disposed = false;
    const generation = socketGenerationRef.current + 1;
    socketGenerationRef.current = generation;
    reconnectAttemptRef.current = 0;
    clearReconnectTimer();
    clearOutboxFlushTimer();
    detachAndCloseSocket(wsRef.current);
    wsRef.current = null;

    roomStateLoadedRef.current = false;
    selectedRoomIdRef.current = selectedRoomId;
    setRecipientPublicKey(null);
    setPeerIdentity(null);
    peerIdentityRef.current = null;
    setSessionReady(false);
    setKeyWarning(null);
    // Server history replay is disabled; only encrypted local transcript and outbox state are restored.
    setMessages([]);
    ratchetSessionRef.current = null;
    inboundMessageKeysRef.current = new Set();
    pendingCiphertextRef.current = [];
    setConnectionState('connecting');

    const isActiveSocket = (socket: WebSocket, event: string, metadata = {}) => {
      const active =
        !disposed && socketGenerationRef.current === generation && wsRef.current === socket;
      if (!active) {
        chatDebug('socket.stale_event_ignored', {
          event,
          expectedGeneration: generation,
          socketGeneration: socketGenerationRef.current,
          selectedRoomId: selectedRoomIdRef.current,
          roomId: selectedRoomId,
          ...metadata,
        });
      }
      return active;
    };

    const scheduleReconnect = () => {
      if (disposed || socketGenerationRef.current !== generation) return;
      if (reconnectAttemptRef.current >= RECONNECT_MAX_ATTEMPTS) {
        setConnectionState('error');
        return;
      }

      reconnectAttemptRef.current += 1;
      const delay = Math.min(
        RECONNECT_BASE_DELAY_MS * 2 ** (reconnectAttemptRef.current - 1),
        RECONNECT_MAX_DELAY_MS,
      );
      setConnectionState('reconnecting');
      clearReconnectTimer();
      reconnectTimerRef.current = setTimeout(() => {
        reconnectTimerRef.current = null;
        openSocket(true);
      }, delay);
    };

    const openSocket = (isReconnect: boolean) => {
      if (disposed || socketGenerationRef.current !== generation) return;

      setConnectionState(isReconnect ? 'reconnecting' : 'connecting');
      const socket = new WebSocket(getWebSocketUrl());
      wsRef.current = socket;

      socket.onopen = () => {
        if (!isActiveSocket(socket, 'open')) return;
        chatDebug('socket.open', {
          roomId: selectedRoomId,
          selectedRoomId: selectedRoomIdRef.current,
          socketGeneration: generation,
        });
        socket.send(JSON.stringify({ type: 'auth', token: user.token }));
      };

      socket.onmessage = async (ev) => {
        if (!isActiveSocket(socket, 'message')) return;
        const msg = JSON.parse(ev.data) as WsClientMessage;
        chatDebug('socket.message_received', {
          type: msg.type,
          clientMessageId: messageClientId(msg),
          roomId: messageRoomId(msg),
          selectedRoomId: selectedRoomIdRef.current,
          socketGeneration: generation,
        });

        if (msg.type === 'auth_ok') {
          socket.send(JSON.stringify({ type: 'join', roomId: selectedRoomId }));
          await ensureKeys(user.username);
          if (!isActiveSocket(socket, 'auth_ok_after_keys')) return;
          const myPub = getPublicKey(user.username);
          if (myPub) {
            socket.send(
              JSON.stringify({
                type: 'public_key',
                userId: user.id,
                publicKey: myPub,
                roomId: selectedRoomId,
              }),
            );
          }
          return;
        }

        if (msg.type === 'joined') {
          if (msg.roomId === selectedRoomId) {
            reconnectAttemptRef.current = 0;
            setConnectionState('connected');
            chatDebug('socket.joined', {
              roomId: msg.roomId,
              selectedRoomId: selectedRoomIdRef.current,
              socketGeneration: generation,
              joinReady: true,
            });
            scheduleOutboxFlush(0);
          }
          return;
        }

        if (msg.type === 'public_key') {
          if (msg.userId === user.id) return;
          if (msg.roomId !== selectedRoomId) return;
          if (
            peerIdentityRef.current?.userId === msg.userId &&
            peerIdentityRef.current.publicKey !== msg.publicKey
          ) {
            setSessionReady(false);
            ratchetSessionRef.current = null;
            pendingCiphertextRef.current = [];
          }
          const nextPeerIdentity = { userId: msg.userId, publicKey: msg.publicKey };
          peerIdentityRef.current = nextPeerIdentity;
          setPeerIdentity(nextPeerIdentity);
          setRecipientPublicKey(msg.publicKey);
          scheduleOutboxFlush(0);

          void auditPeerKey(msg.userId, msg.publicKey);
          return;
        }

        if (msg.type === 'ciphertext') {
          const messageRoomId = msg.roomId ?? selectedRoomId;
          if (!messageRoomId) return;

          if (messageRoomId !== selectedRoomId) {
            await queueInboundCiphertext(msg, messageRoomId);
            return;
          }
          if (!sessionReadyRef.current || !ratchetSessionRef.current) {
            chatDebug('recipient.decrypt_deferred', {
              clientMessageId: msg.clientMessageId ?? msg.id,
              roomId: msg.roomId,
              selectedRoomId,
              socketGeneration: generation,
              ratchetReady: false,
            });
            pendingCiphertextRef.current.push(msg);
            return;
          }
          try {
            await decryptCiphertextMsg(msg);
          } catch (e) {
            console.warn('decrypt failed', e);
          }
        }

        if (msg.type === 'message.accepted') {
          if (msg.roomId !== selectedRoomId) return;
          await markOutboxSent(msg.roomId, msg.clientMessageId, msg.relayTargetCount);
          return;
        }

        if (msg.type === 'message.delivered') {
          const deliveredId = msg.clientMessageId;
          const deliveredRoomId = msg.roomId;
          if (!outboxRef.current.has(outboxKey(deliveredRoomId, deliveredId))) return;
          await removeOutboxEntry(deliveredRoomId, deliveredId);
          if (selectedRoomIdRef.current !== deliveredRoomId) return;
          setMessages((prev) => {
            const updated = prev.map((m) =>
              m.id === deliveredId ? { ...m, status: 'delivered' } : m,
            );
            const delivered = updated.find((m) => m.id === deliveredId);
            if (delivered) {
              saveLocalMessage(user.id, deliveredRoomId, delivered).catch((e) => {
                console.warn('failed to persist delivered status', e);
              });
            }
            return updated;
          });
        }
      };

      socket.onerror = () => {
        if (!isActiveSocket(socket, 'error')) return;
        setConnectionState('error');
      };

      socket.onclose = () => {
        if (!isActiveSocket(socket, 'close')) return;
        wsRef.current = null;
        void markRoomOutboxPending(selectedRoomId);
        scheduleReconnect();
      };
    };

    (async () => {
      ensureKeys(user.username).catch(() => {});

      try {
        const [localMessages, localSession, outboxEntries, pendingInbound] = await Promise.all([
          loadLocalMessages(user.id, selectedRoomId),
          loadRatchetSession(user.id, selectedRoomId),
          loadOutboxEntries(user.id, selectedRoomId),
          loadPendingInboundCiphertexts(user.id, selectedRoomId),
        ]);
        if (disposed || socketGenerationRef.current !== generation) return;

        for (const entryKey of [...outboxRef.current.keys()]) {
          if (entryKey.startsWith(`${selectedRoomId}|`)) {
            outboxRef.current.delete(entryKey);
          }
        }

        const normalizedOutboxEntries = outboxEntries.map((entry) =>
          entry.status === 'sending'
            ? {
                ...entry,
                status: 'pending' as const,
                nextRetryAt: 0,
                updatedAt: Date.now(),
              }
            : entry,
        );
        for (const entry of normalizedOutboxEntries) {
          outboxRef.current.set(outboxKey(entry.roomId, entry.clientMessageId), entry);
        }

        inboundMessageKeysRef.current = new Set(
          localMessages
            .filter((message) => message.from !== user.id)
            .map((message) => inboundMessageKey(selectedRoomId, message.from, message.id)),
        );
        setMessages(mergeMessagesWithOutbox(localMessages, normalizedOutboxEntries, user.id));
        if (localSession) {
          ratchetSessionRef.current = localSession;
          setSessionReady(true);
        }
        pendingCiphertextRef.current = pendingInbound.map((pending) => ({
          type: 'ciphertext' as const,
          id: pending.id,
          clientMessageId: pending.clientMessageId,
          roomId: pending.roomId,
          from: pending.from,
          ciphertext: pending.ciphertext,
          timestamp: pending.timestamp,
        }));
        roomStateLoadedRef.current = true;
      } catch (e) {
        console.warn('failed to load local chat state', e);
        roomStateLoadedRef.current = true;
      }

      if (disposed || socketGenerationRef.current !== generation) return;
      openSocket(false);
    })();

    return () => {
      disposed = true;
      clearReconnectTimer();
      clearOutboxFlushTimer();
      void markRoomOutboxPending(selectedRoomId);
      const session = ratchetSessionRef.current;
      if (session && selectedRoomId) {
        void saveRatchetSession(user.id, selectedRoomId, session);
      }
      if (socketGenerationRef.current === generation) {
        socketGenerationRef.current += 1;
      }
      detachAndCloseSocket(wsRef.current);
      wsRef.current = null;
      setConnectionState('disconnected');
    };
  }, [
    selectedRoomId,
    user.username,
    user.token,
    user.id,
    decryptCiphertextMsg,
    queueInboundCiphertext,
    auditPeerKey,
    setKeyWarning,
    clearReconnectTimer,
    clearOutboxFlushTimer,
    markRoomOutboxPending,
    markOutboxSent,
    removeOutboxEntry,
    scheduleOutboxFlush,
  ]);

  useEffect(() => {
    scheduleOutboxFlush(0);
  }, [connectionState, recipientPublicKey, scheduleOutboxFlush, sessionReady]);

  const send = useCallback(async () => {
    const plaintext = text;
    const roomId = selectedRoomIdRef.current;
    if (!plaintext.trim() || !roomId) return;

    const id = uuidv4();
    const timestamp = Date.now();
    const entry: OutboxEntry = {
      version: 1,
      localId: id,
      clientMessageId: id,
      roomId,
      plaintext,
      status: 'pending',
      retryCount: 0,
      nextRetryAt: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    setText('');
    chatDebug(
      'outbox.queued',
      outboxTrace(entry, selectedRoomIdRef.current, {
        socketGeneration: socketGenerationRef.current,
        connectionState: connectionStateRef.current,
        joinReady: connectionStateRef.current === 'connected',
        ratchetReady: Boolean(sessionReadyRef.current && ratchetSessionRef.current),
      }),
    );
    await persistOutboxEntry(entry);
    scheduleOutboxFlush(0);
  }, [persistOutboxEntry, scheduleOutboxFlush, text]);

  const retryMessage = useCallback(
    async (messageId: string) => {
      const entry = [...outboxRef.current.values()].find(
        (candidate) =>
          candidate.clientMessageId === messageId &&
          candidate.roomId === selectedRoomIdRef.current &&
          candidate.status === 'failed',
      );
      if (!entry) return;

      await persistOutboxEntry({
        ...entry,
        status: 'pending',
        retryCount: 0,
        nextRetryAt: 0,
        updatedAt: Date.now(),
        lastError: undefined,
      });
      scheduleOutboxFlush(0);
    },
    [persistOutboxEntry, scheduleOutboxFlush],
  );

  const socketConnected = connectionState === 'connected';

  return {
    canSendE2E: Boolean(socketConnected && recipientPublicKey && sessionReady),
    connectionState,
    messages,
    messagesEndRef,
    peerIdentity,
    retryMessage,
    send,
    setText,
    text,
  };
}

function detachAndCloseSocket(socket: WebSocket | null) {
  if (!socket) return;
  socket.onopen = null;
  socket.onmessage = null;
  socket.onerror = null;
  socket.onclose = null;
  if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
    socket.close();
  }
}

function outboxKey(roomId: string, clientMessageId: string): string {
  return `${roomId}|${clientMessageId}`;
}

function inboundMessageKey(roomId: string, senderUserId: string, clientMessageId: string): string {
  return `${roomId}|${senderUserId}|${clientMessageId}`;
}

function outboxEntryToMessage(entry: OutboxEntry, userId: string): Message {
  return {
    id: entry.clientMessageId,
    text: entry.plaintext,
    from: userId,
    ts: entry.createdAt,
    status: entry.status,
  };
}

function mergeMessagesWithOutbox(
  localMessages: Message[],
  outboxEntries: OutboxEntry[],
  userId: string,
): Message[] {
  const byId = new Map(localMessages.map((message) => [message.id, message]));
  for (const entry of outboxEntries) {
    byId.set(entry.clientMessageId, {
      ...byId.get(entry.clientMessageId),
      ...outboxEntryToMessage(entry, userId),
    });
  }
  return [...byId.values()].sort((a, b) => a.ts - b.ts);
}

function outboxRetryDelay(attempt: number): number {
  return Math.min(OUTBOX_BASE_RETRY_MS * 2 ** Math.max(0, attempt - 1), OUTBOX_MAX_RETRY_MS);
}

function nextDueOutboxTimestamp(
  roomId: string | undefined,
  outbox: Map<string, OutboxEntry>,
): number | null {
  if (!roomId) return null;
  const dueEntries = [...outbox.values()].filter(
    (entry) =>
      entry.roomId === roomId && (entry.status === 'pending' || entry.status === 'sending'),
  );
  if (dueEntries.length === 0) return null;
  return Math.min(...dueEntries.map((entry) => entry.nextRetryAt));
}

function chatDebug(event: string, metadata: Record<string, unknown>) {
  if (!DEBUG_CHAT) return;
  console.debug('[chat-debug]', event, metadata);
}

function outboxTrace(
  entry: OutboxEntry,
  selectedRoomId: string | undefined,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    clientMessageId: entry.clientMessageId,
    localId: entry.localId,
    roomId: entry.roomId,
    selectedRoomId,
    outboxStatus: entry.status,
    retryCount: entry.retryCount,
    ...extra,
  };
}

function messageClientId(msg: WsClientMessage): string | undefined {
  if ('clientMessageId' in msg) return msg.clientMessageId;
  if ('id' in msg) return msg.id;
  return undefined;
}

function messageRoomId(msg: WsClientMessage): string | undefined {
  if ('roomId' in msg) return msg.roomId;
  return undefined;
}
