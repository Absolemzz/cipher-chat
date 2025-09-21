import React, { useEffect, useRef, useState } from 'react'
import { encryptMessage, decryptMessage, ensureKeys } from '../crypto/crypto'
import { v4 as uuidv4 } from 'uuid'

declare global { interface Window { BACKEND_HOST?: string } }

export default function ChatRoom({ user, room, onLeave }: any) {
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [text, setText] = useState('');
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    ensureKeys(user.username).catch(() => {});
    const host = window.BACKEND_HOST || location.hostname;
    const socket = new WebSocket(`ws://${host}:4000/?token=${user.token}`);
    wsRef.current = socket;
    
    socket.addEventListener('open', () => {
      socket.send(JSON.stringify({ type: 'join', roomId: room.id }));
    });
    
    socket.addEventListener('message', async (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.type === 'ciphertext') {
        try {
          const plaintext = await decryptMessage(msg.ciphertext, msg.from);
          setMessages(prev => [...prev, { 
            id: msg.id, 
            text: plaintext, 
            from: msg.from, 
            ts: msg.timestamp 
          }]);
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
    
    setWs(socket);
    return () => {
      try { socket.close(); } catch (e) {}
    }
  }, [room.id]);

  async function send() {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      alert('socket not ready');
      return;
    }
    const id = uuidv4();
    const ciphertext = await encryptMessage(text, null);
    const payload = { 
      type: 'ciphertext', 
      id, 
      roomId: room.id, 
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

  return (
    <div style={{ padding: 20 }}>
      <h3>Room: {room.code}</h3>
      <div style={{ 
        height: 300, 
        overflow: 'auto', 
        border: '1px solid #ddd', 
        padding: 10, 
        marginBottom: 10 
      }}>
        {messages.map(m => (
          <div key={m.id}>
            <b>{m.from}</b>: {m.text} <small>{m.status || ''}</small>
          </div>
        ))}
      </div>
      <div>
        <input 
          style={{ width: '60%' }} 
          value={text} 
          onChange={e => setText(e.target.value)} 
        />
        {' '}
        <button onClick={send}>Send</button>
        {' '}
        <button onClick={onLeave}>Leave</button>
      </div>
    </div>
  )
}