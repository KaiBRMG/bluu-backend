'use client';

import Link from 'next/link';
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

  if (!userData?.permittedPageIds?.includes('time-tracking')) return null;

  const { color, Icon } = STATE_CONFIG[displayState];
  const isOnBreak = displayState === 'on-break';
  const displaySeconds = isOnBreak && breakRemainingSeconds !== null ? breakRemainingSeconds : elapsedSeconds;

  // A real anchor, not a `router.push` button: `NavigationWatchdog` only
  // observes `<a href>` clicks, so an imperative push here was the one top-bar
  // navigation it could not rescue after a deploy. As a link it is armed on
  // click *and* re-evaluated on every repeat click — the escape hatch when a
  // wedged main thread starves the watchdog's timer. No prefetch: persistent
  // chrome (rule 9i).
  return (
    <Link
      href="/applications/time-tracking"
      prefetch={false}
      className="flex items-center gap-2.5 px-4 py-1.5 transition-opacity hover:opacity-80"
      style={{
        borderRadius: '9999px',
        background: '#0a0a0a',
        border: `1px solid ${color}4D`,
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
    </Link>
  );
}
