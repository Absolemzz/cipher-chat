import React from 'react';
import type { Room } from '../../types';

interface RoomSidebarProps {
  myFingerprint: string | null;
  onLeaveRoom: (room: Room) => void;
  onSearchTermChange: (value: string) => void;
  onSelectRoom: (room: Room) => void;
  rooms: Room[];
  searchTerm: string;
  selectedRoomId: string | undefined;
}

export function RoomSidebar({
  myFingerprint,
  onLeaveRoom,
  onSearchTermChange,
  onSelectRoom,
  rooms,
  searchTerm,
  selectedRoomId,
}: RoomSidebarProps) {
  return (
    <aside className="flex w-[260px] flex-shrink-0 flex-col border-r border-zinc-800 bg-zinc-900/95">
      <div className="flex h-[120px] flex-shrink-0 flex-col justify-center border-b border-zinc-800 px-4">
        <h1 className="text-base font-semibold tracking-tight text-zinc-100">Cypher Chat</h1>
        <input
          className="mt-3 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 outline-none focus:border-zinc-600"
          placeholder="Search conversations..."
          value={searchTerm}
          onChange={(e) => onSearchTermChange(e.target.value)}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {rooms.map((room) => (
          <div
            key={room.id}
            className={`group relative cursor-pointer border-b border-zinc-800/80 p-3 hover:bg-zinc-800/60 ${
              selectedRoomId === room.id ? 'bg-zinc-800/80' : ''
            }`}
            onClick={() => onSelectRoom(room)}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-zinc-200">
                  <span className="text-zinc-500">Room </span>
                  <span className="font-mono text-zinc-100">{room.code}</span>
                </div>
                <div className="mt-0.5 text-xs text-zinc-500">
                  {room.joined_at ? new Date(room.joined_at).toLocaleDateString() : ''}
                </div>
              </div>
              <button
                type="button"
                className="flex-shrink-0 text-lg text-zinc-500 opacity-0 transition hover:text-red-400 group-hover:opacity-100"
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirm(`Are you sure you want to leave Room: ${room.code}?`)) {
                    onLeaveRoom(room);
                  }
                }}
              >
                ×
              </button>
            </div>
          </div>
        ))}
      </div>

      {myFingerprint && (
        <div className="flex-shrink-0 border-t border-zinc-800 p-3">
          <div className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
            Your key fingerprint
          </div>
          <div className="mt-1.5 break-all font-mono text-xs leading-relaxed text-zinc-400">
            {myFingerprint}
          </div>
        </div>
      )}
    </aside>
  );
}
