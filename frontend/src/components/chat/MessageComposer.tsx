import React from 'react';
import type { ChatConnectionState } from '../../hooks/useLiveRatchetChat';

interface MessageComposerProps {
  canSendE2E: boolean;
  connectionState: ChatConnectionState;
  onSend: () => void;
  onTextChange: (text: string) => void;
  text: string;
}

function connectionStatusText(connectionState: ChatConnectionState, canSendE2E: boolean): string {
  if (connectionState === 'connected') {
    return canSendE2E ? 'Secure session ready' : 'Waiting for peer and session...';
  }
  if (connectionState === 'connecting') return 'Connecting to chat...';
  if (connectionState === 'reconnecting') return 'Reconnecting to chat...';
  if (connectionState === 'error') return 'Chat connection error. Retrying if possible...';
  return 'Chat connection disconnected';
}

export function MessageComposer({
  canSendE2E,
  connectionState,
  onSend,
  onTextChange,
  text,
}: MessageComposerProps) {
  const statusText = connectionStatusText(connectionState, canSendE2E);
  const hasText = text.trim().length > 0;

  return (
    <div className="flex-shrink-0 border-t border-zinc-800 bg-zinc-950 p-4">
      <div className="mb-2 text-xs text-zinc-500">{statusText}</div>
      <div className="flex gap-2">
        <input
          className="min-w-0 flex-1 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 outline-none focus:border-zinc-600 disabled:cursor-not-allowed disabled:opacity-50"
          placeholder="Type a message..."
          value={text}
          onChange={(e) => onTextChange(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && hasText && onSend()}
        />
        <button
          type="button"
          onClick={onSend}
          disabled={!hasText}
          className="flex-shrink-0 rounded-lg border border-zinc-700 bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          Send
        </button>
      </div>
    </div>
  );
}
