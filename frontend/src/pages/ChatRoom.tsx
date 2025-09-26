import React, { useEffect, useRef, useState } from 'react'
import { encryptMessage, decryptMessage, ensureKeys } from '../crypto/crypto'
import { v4 as uuidv4 } from 'uuid'

declare global { interface Window { BACKEND_HOST?: string } }

export default function ChatRoom({ user, room, onLeave }: any) {
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [text, setText] = useState('');
  const [rooms, setRooms] = useState<any[]>([]);
  const [selectedRoom, setSelectedRoom] = useState<any>(room);
  const [searchTerm, setSearchTerm] = useState('');
  const wsRef = useRef<WebSocket | null>(null);

  // Fetch user's rooms
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
    const host = window.BACKEND_HOST || location.hostname;
    const socket = new WebSocket(`ws://${host}:4000/?token=${user.token}`);
    wsRef.current = socket;
    
    socket.addEventListener('open', async () => {
      socket.send(JSON.stringify({ type: 'join', roomId: selectedRoom.id }));
      
      // Load message history
      try {
        const res = await fetch(`${location.protocol}//${location.hostname}:4000/rooms/${selectedRoom.id}/messages`, {
          headers: { 'Authorization': `Bearer ${user.token}` }
        });
        const history = await res.json();
        const decryptedHistory = await Promise.all(
          history.map(async (msg: any) => {
            try {
              const plaintext = await decryptMessage(msg.ciphertext, msg.sender_id);
              return { id: msg.id, text: plaintext, from: msg.sender_id, ts: msg.timestamp };
            } catch (e) {
              return null;
            }
          })
        );
        setMessages(decryptedHistory.filter(Boolean));
      } catch (e) {
        console.warn('failed to load message history', e);
      }
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
  }, [selectedRoom?.id]);

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
      roomId: selectedRoom.id, 
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

  async function handleLeaveRoom(roomToLeave: any) {
    // Call backend to persist room leaving
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
      if (updatedRooms.length > 0) {
        setSelectedRoom(updatedRooms[0]);
      } else {
        setSelectedRoom(null);
      }
    }
  }

  const filteredRooms = rooms.filter(r => 
    r.code.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div style={{backgroundColor: '#000000', minHeight: '100vh'}}>  
      <div className="flex h-screen">
        {/* Left Sidebar */}
        <div className="flex-1 bg-gray-900 bg-opacity-90 flex flex-col">
          <div className="p-4 border-b border-gray-700" style={{height: '120px'}}>
            <h1 className="text-white text-xl font-semibold mb-3">Cypher Chat</h1>
            <input
              className="w-full px-3 py-2 bg-gray-800 rounded-lg text-white placeholder-gray-400 text-sm focus:outline-none"
              placeholder="Search conversations..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
            />
          </div>
          
          <div className="flex-1 overflow-y-auto">
            {filteredRooms.map(r => (
              <div
                key={r.id}
                className={`p-3 border-b border-gray-800 hover:bg-gray-800 hover:border-gray-600 cursor-pointer group relative ${
                  selectedRoom?.id === r.id ? 'bg-gray-700' : ''
                }`}
                onClick={() => setSelectedRoom(r)}
              >
                <div className="flex justify-between items-center">
                  <div>
                    <div className="text-white text-sm font-medium">Room: {r.code}</div>
                    <div className="text-gray-400 text-xs">{new Date(r.joined_at).toLocaleDateString()}</div>
                  </div>
                  <button 
                    className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-400 text-lg"
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
        </div>

        {/* Right side (Chat or Empty state) */}
        <div className="flex-1 flex flex-col bg-gray-800">
          {selectedRoom ? (
            <>
              {/* Header */}
              <div className="bg-gray-800 p-4 border-b border-gray-700 flex justify-between items-center" style={{height: '120px'}}>
                <h3 className="text-lg font-medium text-white">Room: {selectedRoom.code}</h3>
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
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-gray-400">
              No chats open. Select or join a room.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}