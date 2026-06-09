import React from 'react';
import { ChatHeader } from '../components/chat/ChatHeader';
import { KeyWarningBanner } from '../components/chat/KeyWarningBanner';
import { MessageComposer } from '../components/chat/MessageComposer';
import { MessageList } from '../components/chat/MessageList';
import { PeerVerificationPanel } from '../components/chat/PeerVerificationPanel';
import { RoomSidebar } from '../components/chat/RoomSidebar';
import { useLiveRatchetChat } from '../hooks/useLiveRatchetChat';
import { useMyFingerprint } from '../hooks/useMyFingerprint';
import { usePeerKeyAudit } from '../hooks/usePeerKeyAudit';
import { usePeerVerification } from '../hooks/usePeerVerification';
import { useRoomList } from '../hooks/useRoomList';
import type { Room, User } from '../types';

interface ChatRoomProps {
  user: User;
  room: Room;
  onLogout: () => void;
}

export default function ChatRoom({ user, room, onLogout }: ChatRoomProps) {
  const myFingerprint = useMyFingerprint(user.username);
  const {
    filteredRooms,
    leaveRoom,
    searchTerm,
    selectedRoom,
    selectedRoomId,
    setSearchTerm,
    setSelectedRoom,
  } = useRoomList(user, room);
  const { auditPeerKey, keyWarning, setKeyWarning } = usePeerKeyAudit(user);
  const {
    canSendE2E,
    connectionState,
    messages,
    messagesEndRef,
    peerIdentity,
    retryMessage,
    send,
    setText,
    text,
  } = useLiveRatchetChat({
    auditPeerKey,
    selectedRoomId,
    setKeyWarning,
    user,
  });
  const peerVerification = usePeerVerification({
    peerIdentity,
    roomId: selectedRoomId,
    user,
  });

  return (
    <div className="min-h-screen bg-zinc-950">
      <div className="flex h-screen min-h-0">
        <RoomSidebar
          myFingerprint={myFingerprint}
          onLeaveRoom={leaveRoom}
          onSearchTermChange={setSearchTerm}
          onSelectRoom={setSelectedRoom}
          rooms={filteredRooms}
          searchTerm={searchTerm}
          selectedRoomId={selectedRoomId}
        />

        <div className="flex min-w-0 min-h-0 flex-1 flex-col bg-zinc-950">
          {selectedRoom ? (
            <>
              <ChatHeader
                canSendE2E={canSendE2E}
                onLogout={onLogout}
                room={selectedRoom}
                verificationPanel={
                  <PeerVerificationPanel
                    onMarkVerified={peerVerification.markVerified}
                    onResetVerification={peerVerification.resetVerification}
                    safetyNumber={peerVerification.safetyNumber}
                    status={peerVerification.status}
                  />
                }
              />

              {keyWarning && (
                <KeyWarningBanner keyWarning={keyWarning} onDismiss={() => setKeyWarning(null)} />
              )}

              <MessageList
                messages={messages}
                messagesEndRef={messagesEndRef}
                onRetryMessage={retryMessage}
                userId={user.id}
              />

              <MessageComposer
                canSendE2E={canSendE2E}
                connectionState={connectionState}
                onSend={send}
                onTextChange={setText}
                text={text}
              />
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center text-sm text-zinc-500">
              No chats open. Select or join a room.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
