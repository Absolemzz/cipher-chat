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
    <div style={{backgroundColor: '#000000', minHeight: '100vh'}}>  
      <div className="max-w-4xl mx-auto h-screen flex flex-col bg-gray-800">
        {/* Header */}
        <div className="bg-gray-800 p-4 border-b border-gray-700 flex justify-between items-center">
          <h3 className="text-lg font-medium text-white">Room: {room.code}</h3>
          <button 
            onClick={onLeave}
            className="text-sm text-gray-400 hover:text-white px-3 py-1 rounded"
          >
            Leave
          </button>
        </div>
        
        {/* Messages area */}
        <div className="flex-1 overflow-y-auto p-4 bg-gray-800">
          {messages.map(m => {
            const isMe = m.from === user.id;
            return (
              <div key={m.id} className={`mb-3 flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-sm px-3 py-2 rounded-lg ${
                  isMe 
                    ? 'bg-blue-600 text-white' 
                    : 'bg-gray-700 text-gray-100'
                }`}>
                  <div className="text-sm">{m.text}</div>
                  <div className={`text-xs mt-1 ${isMe ? 'text-blue-200' : 'text-gray-400'}`}>
                    {new Date(m.ts).toLocaleTimeString()} {m.status && `• ${m.status}`}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        
        {/* Input area */}
        <div className="bg-gray-800 p-4 border-t border-gray-700">
          <div className="flex gap-2">
            <input 
              className="flex-1 px-3 py-2 bg-gray-800 rounded-lg text-white placeholder-gray-400 focus:outline-none"
              placeholder="Type a message..."
              value={text} 
              onChange={e => setText(e.target.value)}
              onKeyPress={e => e.key === 'Enter' && send()}
            />
            <button 
              onClick={send}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              Send
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}