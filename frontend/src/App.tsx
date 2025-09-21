import React, { useState } from 'react'
import Login from './pages/Login'
import ChatRoom from './pages/ChatRoom'

export default function App() {
  const [user, setUser] = useState(null as any);
  const [room, setRoom] = useState(null as any);

  if (!user) return <Login onLogin={setUser} />;
  if (!room) return <div style={{padding:20}}><h2>Welcome, {user.username}</h2><ChatRoomSelector onJoin={setRoom} user={user} /></div>;

  return <ChatRoom user={user} room={room} onLeave={() => setRoom(null)} />;
}

function ChatRoomSelector({ onJoin, user }: any) {
  const [code, setCode] = useState('');
  async function join() {
    const res = await fetch(`${location.protocol}//${location.hostname}:4000/rooms/${code}`);
    const data = await res.json();
    if (data && data.id) onJoin({ id: data.id, code: data.code });
    else alert('room not found');
  }
  async function create() {
    const res = await fetch(`${location.protocol}//${location.hostname}:4000/rooms`, { method: 'POST' });
    const data = await res.json();
    onJoin({ id: data.id, code: data.code });
  }
  return (<div style={{padding:20}}>
    <div style={{marginBottom:10}}><button onClick={create}>Create Room</button></div>
    <div><input value={code} onChange={e=>setCode(e.target.value)} placeholder="invite code" /> <button onClick={join}>Join</button></div>
  </div>)
}
