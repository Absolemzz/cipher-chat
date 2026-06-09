import React, { useState } from 'react';
import type { SafetyNumber } from '../../crypto/safety-number';
import type { PeerVerificationStatus } from '../../hooks/usePeerVerification';

interface PeerVerificationPanelProps {
  onMarkVerified: () => Promise<void>;
  onResetVerification: () => Promise<void>;
  safetyNumber: SafetyNumber | null;
  status: PeerVerificationStatus;
}

function statusCopy(status: PeerVerificationStatus): { label: string; className: string } {
  if (status === 'verified') {
    return { label: 'Peer verified', className: 'text-emerald-400' };
  }
  if (status === 'key_changed') {
    return { label: 'Peer key changed - verification reset', className: 'text-amber-300' };
  }
  if (status === 'unverified') {
    return { label: 'Peer unverified', className: 'text-zinc-400' };
  }
  return { label: 'No peer key available', className: 'text-zinc-500' };
}

export function PeerVerificationPanel({
  onMarkVerified,
  onResetVerification,
  safetyNumber,
  status,
}: PeerVerificationPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const copy = statusCopy(status);
  const canVerify = Boolean(safetyNumber);

  async function handleMarkVerified() {
    if (
      !confirm(
        'Only mark this peer as verified after comparing the safety number out-of-band with them.',
      )
    ) {
      return;
    }
    await onMarkVerified();
    setIsOpen(false);
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
      <span className={copy.className}>{copy.label}</span>
      <button
        type="button"
        className="text-zinc-500 hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-50"
        disabled={!canVerify}
        onClick={() => setIsOpen(true)}
      >
        View safety number
      </button>
      {status === 'verified' || status === 'key_changed' ? (
        <button
          type="button"
          className="text-zinc-500 hover:text-zinc-200"
          onClick={() => {
            onResetVerification().catch((error) => {
              console.warn('failed to reset peer verification', error);
            });
          }}
        >
          Reset verification
        </button>
      ) : null}

      {isOpen && safetyNumber ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Safety number"
          className="fixed inset-0 z-20 flex items-center justify-center bg-black/70 px-4"
        >
          <div className="w-full max-w-md rounded-lg border border-zinc-800 bg-zinc-950 p-5 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-sm font-semibold text-zinc-100">Safety number</h2>
                <p className="mt-1 text-xs leading-relaxed text-zinc-400">
                  Compare this number with your peer using another channel before marking them as
                  verified.
                </p>
              </div>
              <button
                type="button"
                className="text-sm text-zinc-500 hover:text-zinc-200"
                onClick={() => setIsOpen(false)}
              >
                Close
              </button>
            </div>

            <div className="mt-4 rounded-md border border-zinc-800 bg-zinc-900 p-3 font-mono text-sm leading-7 text-zinc-100">
              {safetyNumber.number}
            </div>
            <div className="mt-3 break-all font-mono text-[11px] leading-relaxed text-zinc-500">
              Peer key: {safetyNumber.peerKeyFingerprint}
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                className="rounded-md border border-zinc-700 px-3 py-2 text-xs font-medium text-zinc-300 hover:bg-zinc-900"
                onClick={handleMarkVerified}
              >
                Mark as verified
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
