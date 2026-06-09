import { useCallback, useState } from 'react';
import { apiFetch } from '../lib/transport';
import type { User } from '../types';

export function usePeerKeyAudit(user: User) {
  const [keyWarning, setKeyWarning] = useState<string | null>(null);

  const auditPeerKey = useCallback(
    async (peerId: string, currentKey: string) => {
      try {
        const res = await apiFetch(`/keys/${peerId}/log`, {
          headers: { Authorization: `Bearer ${user.token}` },
        });
        if (!res.ok) return;
        const data = (await res.json()) as {
          entries: { public_key: string; published_at: number }[];
        };
        if (data.entries.length <= 1) {
          setKeyWarning(null);
          return;
        }

        const lastKnownKey = localStorage.getItem(`peer_key_${peerId}`);
        if (lastKnownKey && lastKnownKey !== currentKey) {
          setKeyWarning(
            `Peer's identity key has changed (${data.entries.length} keys on record). ` +
              'Verify their fingerprint out-of-band to rule out a MITM attack.',
          );
        } else {
          setKeyWarning(null);
        }
        localStorage.setItem(`peer_key_${peerId}`, currentKey);
      } catch {
        // Network failure should not block live chat.
      }
    },
    [user.token],
  );

  return {
    keyWarning,
    setKeyWarning,
    auditPeerKey,
  };
}
