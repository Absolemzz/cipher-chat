import { useEffect, useState } from 'react';
import { getKeyFingerprint, getPublicKey } from '../crypto/crypto';

export function useMyFingerprint(username: string) {
  const [myFingerprint, setMyFingerprint] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const pub = getPublicKey(username);
    if (!pub) {
      setMyFingerprint(null);
      return;
    }

    getKeyFingerprint(pub).then((fingerprint) => {
      if (!cancelled) setMyFingerprint(fingerprint);
    });

    return () => {
      cancelled = true;
    };
  }, [username]);

  return myFingerprint;
}
