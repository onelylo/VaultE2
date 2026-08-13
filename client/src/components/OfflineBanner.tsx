import React from 'react';
import { WifiOff, Clock } from 'lucide-react';

interface OfflineBannerProps {
  pendingCount: number;
}

export const OfflineBanner: React.FC<OfflineBannerProps> = ({ pendingCount }) => {
  return (
    <div
      role="alert"
      aria-live="assertive"
      className="flex items-center justify-between px-4 py-2.5 bg-emergency-amber/10 border-b border-emergency-amber/40 select-none"
    >
      <div className="flex items-center space-x-2.5">
        {/* Pulsing signal dot */}
        <span className="relative flex h-2.5 w-2.5 flex-shrink-0">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emergency-amber opacity-75" />
          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emergency-amber" />
        </span>

        <WifiOff className="w-4 h-4 text-emergency-amber flex-shrink-0" />

        <span className="font-mono text-xs font-bold text-emergency-amber tracking-wider">
          ⚠️ OFFLINE MODE — Messages will queue locally
        </span>
      </div>

      {pendingCount > 0 && (
        <div className="flex items-center space-x-1.5 bg-emergency-amber/20 border border-emergency-amber/40 rounded-md px-2.5 py-1">
          <Clock className="w-3 h-3 text-emergency-amber" />
          <span className="font-mono text-[11px] font-bold text-emergency-amber">
            {pendingCount} QUEUED
          </span>
        </div>
      )}
    </div>
  );
};
