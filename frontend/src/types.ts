export interface User {
  id: string;
  username: string;
  token: string;
}

export interface Room {
  id: string;
  code: string;
  joined_at?: string;
}

export interface Message {
  id: string;
  text: string;
  from: string;
  ts: number;
  status?: 'pending' | 'sending' | 'sent' | 'delivered' | 'failed' | string;
}

export interface RoomHistoryMessage {
  id: string;
  sender_id: string;
  ciphertext: string;
  timestamp: number;
}

export type WsClientMessage =
  | { type: 'auth_ok'; userId: string }
  | { type: 'joined'; roomId: string }
  | {
      type: 'ciphertext';
      id: string;
      clientMessageId?: string;
      roomId?: string;
      from: string;
      ciphertext: string;
      timestamp: number;
    }
  | {
      type: 'public_key';
      userId: string;
      publicKey: string;
      roomId: string;
    }
  | {
      type: 'message.accepted';
      id: string;
      clientMessageId: string;
      duplicate?: boolean;
      relayAttempted?: boolean;
      relayTargetCount?: number;
      roomId: string;
      timestamp?: number;
    }
  | {
      type: 'message.delivered';
      id: string;
      clientMessageId: string;
      roomId: string;
      timestamp?: number;
    }
  | { type: 'error'; message: string };
