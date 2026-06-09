import React from 'react';
import type { ReactNode } from 'react';
import type { Room } from '../../types';

interface ChatHeaderProps {
  canSendE2E: boolean;
  onLogout: () => void;
  room: Room;
  verificationPanel?: ReactNode;
}

export function ChatHeader({ canSendE2E, onLogout, room, verificationPanel }: ChatHeaderProps) {
  return (
    <div className="flex h-[120px] flex-shrink-0 flex-col justify-center border-b border-zinc-800 bg-zinc-950 px-5">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-sm font-medium text-zinc-400">
            Room <span className="font-mono text-base text-zinc-100">{room.code}</span>
          </h3>
          <div className="mt-2 flex items-center">
            <span className="text-xs text-emerald-500/90">
              {canSendE2E ? 'End-to-end encrypted' : 'Establishing session...'}
            </span>
          </div>
          {verificationPanel}
        </div>
        <button
          type="button"
          onClick={onLogout}
          className="text-xs font-medium text-zinc-500 hover:text-zinc-200"
        >
          Logout
        </button>
      </div>
    </div>
  );
}
