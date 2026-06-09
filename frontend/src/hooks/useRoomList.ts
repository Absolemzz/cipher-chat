import { useCallback, useEffect, useMemo, useState } from 'react';
import { clearRoomLocalState } from '../lib/localEncryptedStore';
import { apiFetch } from '../lib/transport';
import type { Room, User } from '../types';

export function useRoomList(user: User, initialRoom: Room) {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [selectedRoom, setSelectedRoom] = useState<Room | null>(initialRoom);
  const [searchTerm, setSearchTerm] = useState('');
  const selectedRoomId = selectedRoom?.id;

  useEffect(() => {
    async function fetchRooms() {
      try {
        await new Promise((resolve) => setTimeout(resolve, 100));
        const res = await apiFetch(`/users/${user.id}/rooms`, {
          headers: { Authorization: `Bearer ${user.token}` },
        });
        const data = (await res.json()) as Room[];
        setRooms(data);
      } catch (e) {
        console.warn('failed to fetch rooms', e);
      }
    }
    fetchRooms();
  }, [selectedRoomId, user.id, user.token]);

  const leaveRoom = useCallback(
    async (roomToLeave: Room) => {
      try {
        await apiFetch(`/users/${user.id}/rooms/${roomToLeave.id}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${user.token}` },
        });
      } catch (e) {
        console.warn('failed to leave room on server', e);
      }

      try {
        await clearRoomLocalState(user.id, roomToLeave.id);
      } catch (e) {
        console.warn('failed to clear local room state', e);
      }

      const updatedRooms = rooms.filter((r) => r.id !== roomToLeave.id);
      setRooms(updatedRooms);

      if (selectedRoom?.id === roomToLeave.id) {
        setSelectedRoom(updatedRooms.length > 0 ? updatedRooms[0] : null);
      }
    },
    [rooms, selectedRoom?.id, user.id, user.token],
  );

  const filteredRooms = useMemo(
    () => rooms.filter((r) => r.code.toLowerCase().includes(searchTerm.toLowerCase())),
    [rooms, searchTerm],
  );

  return {
    rooms,
    filteredRooms,
    selectedRoom,
    selectedRoomId,
    setSelectedRoom,
    searchTerm,
    setSearchTerm,
    leaveRoom,
  };
}
