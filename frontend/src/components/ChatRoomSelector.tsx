import React, { useState } from 'react'
import type { User, Room } from '../types'

interface ChatRoomSelectorProps {
  onJoin: (room: Room) => void;
  user: User;
}

export default function ChatRoomSelector({ onJoin, user }: ChatRoomSelectorProps) {
  const [code, setCode] = useState('');
  async function join() {
    const res = await fetch(`${location.protocol}//${location.hostname}:4000/rooms/${code}`, {
      headers: { 'Authorization': `Bearer ${user.token}` }
    });
    const data = await res.json();
    if (data && data.id) onJoin({ id: data.id, code: data.code });
    else alert('room not found');
  }
  async function create() {
    const res = await fetch(`${location.protocol}//${location.hostname}:4000/rooms`, { 
      method: 'POST',
      headers: { 'Authorization': `Bearer ${user.token}` }
    });
    const data = await res.json();
    onJoin({ id: data.id, code: data.code });
  }
  return (
    <div className="w-full max-w-md rounded-xl border border-zinc-800 bg-zinc-900/80 p-8 shadow-xl shadow-black/40">
      <p className="text-center text-sm text-zinc-400">Signed in as</p>
      <p className="mt-1 text-center text-base font-medium text-zinc-100">{user.username}</p>

      <div className="mt-8 space-y-6">
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Create room</h2>
          <p className="mt-1 text-sm text-zinc-400">Start a new encrypted room and share the invite code.</p>
          <button
            type="button"
            onClick={create}
            className="mt-4 w-full rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2.5 text-sm font-medium text-zinc-100 transition hover:border-zinc-600 hover:bg-zinc-700"
          >
            Create room
          </button>
        </div>

        <div className="border-t border-zinc-800 pt-6">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Join with code</h2>
          <p className="mt-1 text-sm text-zinc-400">Enter an invite code someone shared with you.</p>
          <input
            value={code}
            onChange={e => setCode(e.target.value)}
            placeholder="Invite code"
            className="mt-4 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-sm text-zinc-100 placeholder-zinc-600 outline-none ring-0 focus:border-zinc-500"
          />
          <button
            type="button"
            onClick={join}
            className="mt-3 w-full rounded-lg border border-zinc-700 bg-transparent px-4 py-2.5 text-sm font-medium text-zinc-200 transition hover:bg-zinc-800"
          >
            Join room
          </button>
        </div>
      </div>
    </div>
  )
}
