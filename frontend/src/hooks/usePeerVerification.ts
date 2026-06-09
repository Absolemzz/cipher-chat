import { useCallback, useEffect, useState } from 'react';
import { getPublicKey } from '../crypto/crypto';
import { deriveSafetyNumber, type SafetyNumber } from '../crypto/safety-number';
import {
  clearPeerVerification,
  getPeerVerification,
  isPeerVerifiedForKey,
  markPeerVerified,
  type PeerVerification,
} from '../lib/localEncryptedStore';
import type { User } from '../types';

export type PeerVerificationStatus = 'no_peer' | 'unverified' | 'verified' | 'key_changed';

interface PeerIdentity {
  userId: string;
  publicKey: string;
}

interface UsePeerVerificationArgs {
  peerIdentity: PeerIdentity | null;
  roomId: string | undefined;
  user: User;
}

export function usePeerVerification({ peerIdentity, roomId, user }: UsePeerVerificationArgs) {
  const [status, setStatus] = useState<PeerVerificationStatus>('no_peer');
  const [safetyNumber, setSafetyNumber] = useState<SafetyNumber | null>(null);
  const [verification, setVerification] = useState<PeerVerification | null>(null);

  const refresh = useCallback(async () => {
    if (!peerIdentity || !roomId) {
      setStatus('no_peer');
      setSafetyNumber(null);
      setVerification(null);
      return;
    }

    const currentIdentityPublicKey = getPublicKey(user.username);
    if (!currentIdentityPublicKey) {
      setStatus('no_peer');
      setSafetyNumber(null);
      setVerification(null);
      return;
    }

    const nextSafetyNumber = await deriveSafetyNumber({
      currentUserId: user.id,
      currentIdentityPublicKey,
      peerUserId: peerIdentity.userId,
      peerIdentityPublicKey: peerIdentity.publicKey,
    });
    const storedVerification = await getPeerVerification(user.id, roomId, peerIdentity.userId);
    const verified = await isPeerVerifiedForKey(
      user.id,
      roomId,
      peerIdentity.userId,
      nextSafetyNumber,
    );

    setSafetyNumber(nextSafetyNumber);
    setVerification(storedVerification);
    if (verified) {
      setStatus('verified');
    } else if (storedVerification) {
      setStatus('key_changed');
    } else {
      setStatus('unverified');
    }
  }, [peerIdentity, roomId, user.id, user.username]);

  useEffect(() => {
    let cancelled = false;
    refresh().catch((error) => {
      if (!cancelled) {
        console.warn('failed to refresh peer verification', error);
        setStatus(peerIdentity ? 'unverified' : 'no_peer');
      }
    });
    return () => {
      cancelled = true;
    };
  }, [peerIdentity, refresh]);

  const markVerified = useCallback(async () => {
    if (!peerIdentity || !roomId || !safetyNumber) return;
    const nextVerification = await markPeerVerified(
      user.id,
      roomId,
      peerIdentity.userId,
      safetyNumber,
    );
    setVerification(nextVerification);
    setStatus('verified');
  }, [peerIdentity, roomId, safetyNumber, user.id]);

  const resetVerification = useCallback(async () => {
    if (!peerIdentity || !roomId) return;
    await clearPeerVerification(user.id, roomId, peerIdentity.userId);
    setVerification(null);
    setStatus(safetyNumber ? 'unverified' : 'no_peer');
  }, [peerIdentity, roomId, safetyNumber, user.id]);

  return {
    markVerified,
    resetVerification,
    safetyNumber,
    status,
    verification,
  };
}
