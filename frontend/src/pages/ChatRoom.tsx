import React, { useCallback, useEffect, useRef, useState } from 'react'
import { encryptMessage, decryptMessage, ensureKeys, getPublicKey, getKeyFingerprint, initializeSessionRootFromPeer } from '../crypto/crypto'
import { v4 as uuidv4 } from 'uuid'
import type { User, Room, Message, RoomHistoryMessage, WsClientMessage } from '../types'

declare global { interface Window { BACKEND_HOST?: string } }

interface ChatRoomProps {
  user: User;
  room: Room;
  onLeave: () => void;
}

export default function ChatRoom({ user, room, onLeave }: ChatRoomProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState('');
  const [rooms, setRooms] = useState<Room[]>([]);
  const [selectedRoom, setSelectedRoom] = useState<Room | null>(room);
  const [searchTerm, setSearchTerm] = useState('');
  const [myFingerprint, setMyFingerprint] = useState<string | null>(null);
  const [recipientPublicKey, setRecipientPublicKey] = useState<string | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const keyCache = useRef<Map<string, string>>(new Map());
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const sessionRoot = useRef<CryptoKey | null>(null);
  const sendIndex = useRef<number>(0);
  const historyLoadedRef = useRef(false);
  const sessionReadyRef = useRef(false);
  const pendingCiphertextRef = useRef<Extract<WsClientMessage, { type: 'ciphertext' }>[]>([]);

  useEffect(() => {
    sessionReadyRef.current = sessionReady;
  }, [sessionReady]);

  useEffect(() => {
    const pub = getPublicKey(user.username);
    if (pub) getKeyFingerprint(pub).then(setMyFingerprint);
  }, [user.username]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (!recipientPublicKey) return;
    let cancelled = false;
    (async () => {
      try {
        const root = await initializeSessionRootFromPeer(user.username, recipientPublicKey);
        if (cancelled) return;
        sessionRoot.current = root;
        setSessionReady(true);
      } catch (e) {
        console.warn('[ChatRoom] initializeSessionRootFromPeer failed', e);
      }
    })();
    return () => { cancelled = true };
  }, [recipientPublicKey, user.username]);

  const decryptCiphertextMsg = useCallback(async (msg: Extract<WsClientMessage, { type: 'ciphertext' }>) => {
    const root = sessionRoot.current;
    if (!root) throw new Error('[ChatRoom] decrypt: session root not ready');
    const { plaintext } = await decryptMessage(msg.ciphertext, root);
    setMessages(prev => [...prev, {
      id: msg.id,
      text: plaintext,
      from: msg.from,
      ts: msg.timestamp
    }]);
  }, []);

  useEffect(() => {
    if (!selectedRoom || !sessionReady || !sessionRoot.current) return;

    let cancelled = false;
    historyLoadedRef.current = false;

    (async () => {
      const root = sessionRoot.current!;
      try {
        const res = await fetch(`${location.protocol}//${location.hostname}:4000/rooms/${selectedRoom.id}/messages`, {
          headers: { 'Authorization': `Bearer ${user.token}` }
        });
        const history = await res.json() as RoomHistoryMessage[];
        const sorted = [...history].sort((a, b) => a.timestamp - b.timestamp);
        let maxIdx = -1;
        const decryptedHistory: (Message | null)[] = [];
        for (const msg of sorted) {
          if (cancelled) return;
          try {
            const parsed = JSON.parse(msg.ciphertext) as { idx?: number };
            if (typeof parsed.idx === 'number') maxIdx = Math.max(maxIdx, parsed.idx);
            const { plaintext } = await decryptMessage(msg.ciphertext, root);
            decryptedHistory.push({ id: msg.id, text: plaintext, from: msg.sender_id, ts: msg.timestamp });
          } catch {
            decryptedHistory.push(null);
          }
        }
        if (cancelled) return;
        sendIndex.current = maxIdx + 1;
        setMessages(decryptedHistory.filter((m): m is Message => m !== null));
      } catch (e) {
        console.warn('failed to load message history', e);
        if (!cancelled) setMessages([]);
      } finally {
        if (cancelled) return;
        historyLoadedRef.current = true;
        const pending = pendingCiphertextRef.current;
        pendingCiphertextRef.current = [];
        for (const p of pending) {
          try {
            await decryptCiphertextMsg(p);
          } catch (e) {
            console.warn('decrypt failed', e);
          }
        }
      }
    })();

    return () => { cancelled = true };
  }, [selectedRoom?.id, sessionReady, user.token, decryptCiphertextMsg]);

  useEffect(() => {
    async function fetchRooms() {
      try {
        await new Promise(resolve => setTimeout(resolve, 100));
        const res = await fetch(`${location.protocol}//${location.hostname}:4000/users/${user.id}/rooms`, {
          headers: { 'Authorization': `Bearer ${user.token}` }
        });
        const data = await res.json();
        setRooms(data);
      } catch (e) {
        console.warn('failed to fetch rooms', e);
      }
    }
    fetchRooms();
  }, [selectedRoom?.id]);

  useEffect(() => {
    if (!selectedRoom) return;
    ensureKeys(user.username).catch(() => {});
    setRecipientPublicKey(null);
    setSessionReady(false);
    setMessages([]);
    sessionRoot.current = null;
    sendIndex.current = 0;
    historyLoadedRef.current = false;
    pendingCiphertextRef.current = [];

    const host = window.BACKEND_HOST || location.hostname;
    const socket = new WebSocket(`ws://${host}:4000/?token=${user.token}`);
    wsRef.current = socket;

    socket.addEventListener('open', async () => {
      socket.send(JSON.stringify({ type: 'join', roomId: selectedRoom.id }));

      await ensureKeys(user.username);
      const myPub = getPublicKey(user.username);
      if (myPub) {
        socket.send(JSON.stringify({
          type: 'public_key',
          userId: user.id,
          publicKey: myPub,
          roomId: selectedRoom.id
        }));
      }
    });

    socket.addEventListener('message', async (ev) => {
      const msg = JSON.parse(ev.data) as WsClientMessage;

      if (msg.type === 'public_key') {
        if (msg.userId === user.id) return;
        if (msg.roomId !== selectedRoom.id) return;
        keyCache.current.set(msg.userId, msg.publicKey);
        setRecipientPublicKey(msg.publicKey);
        return;
      }

      if (msg.type === 'ciphertext') {
        if (!sessionReadyRef.current || !sessionRoot.current || !historyLoadedRef.current) {
          pendingCiphertextRef.current.push(msg);
          return;
        }
        try {
          await decryptCiphertextMsg(msg);
        } catch (e) {
          console.warn('decrypt failed', e);
        }
      }

      if (msg.type === 'delivered') {
        setMessages(prev => prev.map(m =>
          m.id === msg.id ? { ...m, status: 'delivered' } : m
        ));
      }
    });

    return () => {
      try { socket.close(); } catch (e) {}
    }
  }, [selectedRoom?.id, user.token, user.id, decryptCiphertextMsg]);

  async function send() {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      alert('socket not ready');
      return;
    }
    if (!text.trim()) return;
    if (!recipientPublicKey || !sessionRoot.current || !sessionReady) {
      console.error('[ChatRoom] E2E session not established');
      return;
    }

    const id = uuidv4();
    const { ciphertext } = await encryptMessage(
      text,
      sessionRoot.current,
      sendIndex.current
    );
    sendIndex.current += 1;

    const payload = {
      type: 'ciphertext',
      id,
      roomId: selectedRoom!.id,
      ciphertext,
      timestamp: Date.now()
    };

    setMessages(prev => [...prev, {
      id,
      text,
      from: user.id,
      ts: Date.now(),
      status: 'pending'
    }]);
    wsRef.current.send(JSON.stringify(payload));
    setText('');
  }

  async function handleLeaveRoom(roomToLeave: Room) {
    try {
      await fetch(`${location.protocol}//${location.hostname}:4000/users/${user.id}/rooms/${roomToLeave.id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${user.token}` }
      });
    } catch (e) {
      console.warn('failed to leave room on server', e);
    }

    const updatedRooms = rooms.filter(r => r.id !== roomToLeave.id);
    setRooms(updatedRooms);

    if (selectedRoom?.id === roomToLeave.id) {
      setSelectedRoom(updatedRooms.length > 0 ? updatedRooms[0] : null);
    }
  }

  const filteredRooms = rooms.filter(r =>
    r.code.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const canSendE2E = Boolean(recipientPublicKey && sessionReady);

  return (
    <div className="min-h-screen bg-zinc-950">
      <div className="flex h-screen min-h-0">
        <aside className="flex w-[260px] flex-shrink-0 flex-col border-r border-zinc-800 bg-zinc-900/95">
          <div className="flex h-[120px] flex-shrink-0 flex-col justify-center border-b border-zinc-800 px-4">
            <h1 className="text-base font-semibold tracking-tight text-zinc-100">Cypher Chat</h1>
            <input
              className="mt-3 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 outline-none focus:border-zinc-600"
              placeholder="Search conversations..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
            />
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {filteredRooms.map(r => (
              <div
                key={r.id}
                className={`group relative cursor-pointer border-b border-zinc-800/80 p-3 hover:bg-zinc-800/60 ${
                  selectedRoom?.id === r.id ? 'bg-zinc-800/80' : ''
                }`}
                onClick={() => setSelectedRoom(r)}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-zinc-200">
                      <span className="text-zinc-500">Room </span>
                      <span className="font-mono text-zinc-100">{r.code}</span>
                    </div>
                    <div className="mt-0.5 text-xs text-zinc-500">
                      {r.joined_at ? new Date(r.joined_at).toLocaleDateString() : ''}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="flex-shrink-0 text-lg text-zinc-500 opacity-0 transition hover:text-red-400 group-hover:opacity-100"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm(`Are you sure you want to leave Room: ${r.code}?`)) {
                        handleLeaveRoom(r);
                      }
                    }}
                  >×</button>
                </div>
              </div>
            ))}
          </div>

          {myFingerprint && (
            <div className="flex-shrink-0 border-t border-zinc-800 p-3">
              <div className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">Your key fingerprint</div>
              <div className="mt-1.5 break-all font-mono text-xs leading-relaxed text-zinc-400">{myFingerprint}</div>
            </div>
          )}
        </aside>

        <div className="flex min-w-0 min-h-0 flex-1 flex-col bg-zinc-950">
          {selectedRoom ? (
            <>
              <div className="flex h-[120px] flex-shrink-0 flex-col justify-center border-b border-zinc-800 bg-zinc-950 px-5">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="text-sm font-medium text-zinc-400">
                      Room <span className="font-mono text-base text-zinc-100">{selectedRoom.code}</span>
                    </h3>
                    <div className="mt-2 flex items-center gap-1.5">
                      <span className="text-xs text-emerald-500/90">🔒</span>
                      <span className="text-xs text-emerald-500/90">
                        {canSendE2E ? 'End-to-end encrypted' : 'Establishing session…'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto bg-zinc-950 p-4">
                {messages.map(m => {
                  const isMe = m.from === user.id;
                  return (
                    <div key={m.id} className={`mb-3 flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-sm rounded-lg px-3 py-2 ${
                        isMe
                          ? 'border border-zinc-700 bg-zinc-800 text-zinc-100'
                          : 'border border-zinc-800/80 bg-zinc-900 text-zinc-200'
                      }`}>
                        <div className="text-sm">{m.text}</div>
                        <div className="mt-1 text-xs text-zinc-500">
                          {new Date(m.ts).toLocaleTimeString()} {m.status && `• ${m.status}`}
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div ref={messagesEndRef} />
              </div>

              <div className="flex-shrink-0 border-t border-zinc-800 bg-zinc-950 p-4">
                <div className="flex gap-2">
                  <input
                    className="min-w-0 flex-1 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 outline-none focus:border-zinc-600 disabled:cursor-not-allowed disabled:opacity-50"
                    placeholder={canSendE2E ? 'Type a message…' : 'Waiting for peer and session…'}
                    value={text}
                    disabled={!canSendE2E}
                    onChange={e => setText(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && canSendE2E && send()}
                  />
                  <button
                    type="button"
                    onClick={send}
                    disabled={!canSendE2E}
                    className="flex-shrink-0 rounded-lg border border-zinc-700 bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Send
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center text-sm text-zinc-500">
              No chats open. Select or join a room.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
