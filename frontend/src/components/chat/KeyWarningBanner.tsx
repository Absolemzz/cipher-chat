import React from 'react';

interface KeyWarningBannerProps {
  keyWarning: string;
  onDismiss: () => void;
}

export function KeyWarningBanner({ keyWarning, onDismiss }: KeyWarningBannerProps) {
  return (
    <div className="flex items-start gap-2.5 border-b border-amber-800/40 bg-amber-950/60 px-5 py-3">
      <span className="mt-0.5 flex-shrink-0 text-sm text-amber-400">&#9888;</span>
      <div className="min-w-0">
        <p className="text-xs font-medium text-amber-300">Identity key changed</p>
        <p className="mt-0.5 text-xs text-amber-400/80">{keyWarning}</p>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        className="ml-auto flex-shrink-0 text-xs text-amber-500 hover:text-amber-300"
      >
        dismiss
      </button>
    </div>
  );
}
