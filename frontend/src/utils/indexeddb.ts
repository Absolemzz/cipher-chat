// Offline message queue using localStorage
export async function saveOfflineMessage(msg: any) { 
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