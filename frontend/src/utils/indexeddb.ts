import type { Message } from '../types'

export async function saveOfflineMessage(msg: Message) { 
  const arr = JSON.parse(localStorage.getItem('outbox') || '[]');
  arr.push(msg);
  localStorage.setItem('outbox', JSON.stringify(arr));
}

export async function getOfflineMessages() { 
  return JSON.parse(localStorage.getItem('outbox') || '[]'); 
}

export async function clearOffline() { 
  localStorage.removeItem('outbox'); 
}
