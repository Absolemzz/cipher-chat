import React, { useState } from 'react'
import Login from './pages/Login'
import ChatRoom from './pages/ChatRoom'
import ChatRoomSelector from './components/ChatRoomSelector'
import type { User, Room } from './types'

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [room, setRoom] = useState<Room | null>(null);

  if (!user) return <Login onLogin={setUser} />;
  if (!room) return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-zinc-950">
      <ChatRoomSelector onJoin={setRoom} user={user} />
    </div>
  );

  return <ChatRoom user={user} room={room} onLeave={() => setRoom(null)} />;
}
