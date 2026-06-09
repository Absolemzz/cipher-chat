import React from 'react';
import type { Message } from '../../types';

interface MessageListProps {
  messages: Message[];
  messagesEndRef: React.RefObject<HTMLDivElement>;
  onRetryMessage?: (messageId: string) => void;
  userId: string;
}

export function MessageList({
  messages,
  messagesEndRef,
  onRetryMessage,
  userId,
}: MessageListProps) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-zinc-950 p-4">
      {messages.map((message) => {
        const isMe = message.from === userId;
        const statusText = message.status ? messageStatusText(message.status) : null;
        return (
          <div key={message.id} className={`mb-3 flex ${isMe ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-sm rounded-lg px-3 py-2 ${
                isMe
                  ? 'border border-zinc-700 bg-zinc-800 text-zinc-100'
                  : 'border border-zinc-800/80 bg-zinc-900 text-zinc-200'
              }`}
            >
              <div className="text-sm">{message.text}</div>
              <div className="mt-1 text-xs text-zinc-500">
                {new Date(message.ts).toLocaleTimeString()}
                {statusText && ` - ${statusText}`}
              </div>
              {isMe && message.status === 'failed' && onRetryMessage && (
                <button
                  type="button"
                  onClick={() => onRetryMessage(message.id)}
                  className="mt-2 rounded border border-zinc-600 px-2 py-1 text-xs text-zinc-100 hover:border-zinc-400"
                >
                  Retry
                </button>
              )}
            </div>
          </div>
        );
      })}
      <div ref={messagesEndRef} />
    </div>
  );
}
function messageStatusText(status: Message['status']): string {
  if (status === 'pending') return 'Waiting for connection';
  if (status === 'sending') return 'Sending';
  if (status === 'sent') return 'Sent';
  if (status === 'delivered') return 'Delivered';
  if (status === 'failed') return 'Failed';
  return String(status);
}

