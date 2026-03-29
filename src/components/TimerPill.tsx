'use client';

import { useRouter } from 'next/navigation';
import { ArrowUpRight } from 'lucide-react';
import { useTimeTracking } from '@/hooks/useTimeTracking';
import { useUserData } from '@/hooks/useUserData';
import { STATE_CONFIG } from '@/lib/stateColors';

function formatTime(totalSeconds: number): string {
  const hours   = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export default function TimerPill() {
  const { userData } = useUserData();
  const { displayState, elapsedSeconds, breakRemainingSeconds } = useTimeTracking();
  const router = useRouter();

  if (!userData?.permittedPageIds?.includes('time-tracking')) return null;

  const { color, Icon } = STATE_CONFIG[displayState];
  const isOnBreak = displayState === 'on-break';
  const displaySeconds = isOnBreak && breakRemainingSeconds !== null ? breakRemainingSeconds : elapsedSeconds;

  return (
    <button
      onClick={() => router.push('/applications/time-tracking')}
      className="flex items-center gap-2.5 px-4 py-1.5 transition-opacity hover:opacity-80"
      style={{
        borderRadius: '9999px',
        background: '#0a0a0a',
        border: `1px solid ${color}4D`,
        boxShadow: `0 0 8px ${color}1A`,
        flexShrink: 0,
      }}
    >
      <Icon style={{ color, width: 16, height: 16, flexShrink: 0 }} />
      <span
        className="font-mono text-sm font-medium"
        style={{ fontVariantNumeric: 'tabular-nums', letterSpacing: '0.02em', color: isOnBreak ? STATE_CONFIG['on-break'].color : '#ffffff' }}
      >
        {formatTime(displaySeconds)}
      </span>
      <ArrowUpRight style={{ color, width: 16, height: 16, flexShrink: 0 }} />
    </button>
  );
}
