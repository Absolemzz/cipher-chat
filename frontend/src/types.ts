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
  status?: string;
}

export interface RoomHistoryMessage {
  id: string;
  sender_id: string;
  ciphertext: string;
  timestamp: number;
}

export type WsClientMessage =
  | {
      type: 'ciphertext';
      id: string;
      from: string;
      ciphertext: string;
      timestamp: number;
      fromPublicKey?: string;
    }
  | {
      type: 'public_key';
      userId: string;
      publicKey: string;
      roomId: string;
    }
  | { type: 'delivered'; id: string };
