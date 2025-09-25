import React, { useState } from 'react'
import Login from './pages/Login'
import ChatRoom from './pages/ChatRoom'

export default function App() {
  const [user, setUser] = useState(null as any);
  const [room, setRoom] = useState(null as any);

  if (!user) return <Login onLogin={setUser} />;
  if (!room) return <div className="flex flex-col items-center justify-center h-screen" style={{backgroundColor: '#000000'}}><ChatRoomSelector onJoin={setRoom} user={user} /></div>;

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
  return (<div className="bg-gray-800 rounded-lg p-6 max-w-md">
    <h2 className="text-white text-center mb-4">Welcome, {user.username}</h2>
    <div style={{marginBottom:10}}><input value={code} onChange={e=>setCode(e.target.value)} placeholder="Invite code" style={{width:'100%', padding:'6px 8px', border:'2px solid #6b7280', borderRadius:4, outline:'none', boxSizing:'border-box'}} /></div>
    <div style={{marginTop:10, display:'flex', gap:'8px'}}><button onClick={create} style={{flex:1, padding:'8px 12px', backgroundColor:'#374151', color:'white', border:'none', borderRadius:4, cursor:'pointer'}}>Host</button> <button onClick={join} style={{flex:1, padding:'8px 12px', backgroundColor:'#374151', color:'white', border:'none', borderRadius:4, cursor:'pointer'}}>Join</button></div>
  </div>)
}
