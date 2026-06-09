import React, { useState } from 'react';
import Login from './pages/Login';
import ChatRoom from './pages/ChatRoom';
import ChatRoomSelector from './components/ChatRoomSelector';
import { clearAllLocalChatState } from './lib/localEncryptedStore';
import type { User, Room } from './types';

type StoredUser = Pick<User, 'id' | 'username'>;

export function restoreStoredUser(storage?: Pick<Storage, 'getItem' | 'removeItem'>): User | null {
  const targetStorage = storage ?? (typeof localStorage === 'undefined' ? null : localStorage);
  if (!targetStorage) return null;

  try {
    const token = targetStorage.getItem('token');
    const rawUser = targetStorage.getItem('user');
    if (!token || !rawUser) return null;

    const parsed = JSON.parse(rawUser) as Partial<StoredUser>;
    if (typeof parsed.id !== 'string' || typeof parsed.username !== 'string') {
      targetStorage.removeItem('token');
      targetStorage.removeItem('user');
      return null;
    }

    return { id: parsed.id, username: parsed.username, token };
  } catch {
    targetStorage.removeItem('token');
    targetStorage.removeItem('user');
    return null;
  }
}

export default function App() {
  const [user, setUser] = useState<User | null>(() => restoreStoredUser());
  const [room, setRoom] = useState<Room | null>(null);

  function logout() {
    if (user) {
      clearAllLocalChatState(user.id).catch((error) => {
        console.warn('failed to clear local chat state', error);
      });
    }
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setRoom(null);
    setUser(null);
  }

  if (!user) return <Login onLogin={setUser} />;
  if (!room)
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-zinc-950">
        <ChatRoomSelector onJoin={setRoom} onLogout={logout} user={user} />
      </div>
    );

  return <ChatRoom user={user} room={room} onLogout={logout} />;
}
