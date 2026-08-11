'use client';

import { useState, useEffect, useRef } from 'react';
import { useTodaySessions, todaySessionWorkedSeconds } from '@/hooks/useTodaySessions';

/**
 * Returns the total "time worked" seconds tracked today (in the user's timezone),
 * summed across all sessions whose clock-in falls within today's calendar day —
 * on ANY device, since `useTodaySessions` merges the server ledger with this
 * device's local buffers.
 *
 * Counts: working + break seconds. This MUST match the "Total worked" figure in
 * TodayTimeline (working + break) so the timer page's "TODAY" total and the
 * timesheet below it always show the same value. Both sum
 * `todaySessionWorkedSeconds`, which is what keeps them from drifting.
 * Excludes: idle and pause time.
 *
 * - Recomputes every 10s (and whenever the session set changes).
 * - Resets automatically at midnight in the user's timezone by re-running the
 *   effect (driven by a `day` state that increments at midnight).
 */
export function useDayTotal(timezone: string): number {
  const { sessions } = useTodaySessions(timezone);
  const [totalSeconds, setTotalSeconds] = useState(0);
  // Incrementing this triggers the effect to re-run after midnight
  const [day, setDay] = useState(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const midnightRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!timezone) return;

    let cancelled = false;

    function compute() {
      const now = Date.now();
      // Only the live session grows to `now`; everything else is closed at its
      // clock-out / last event so an orphaned buffer can't inflate the total.
      const total = sessions.reduce((sum, s) => sum + todaySessionWorkedSeconds(s, now), 0);
      if (!cancelled) setTotalSeconds(total);
    }

    compute();
    tickRef.current = setInterval(compute, 10000);

    // Schedule reset at next midnight in the user's timezone
    const msUntilMidnight = getMsUntilMidnight(timezone);
    midnightRef.current = setTimeout(() => {
      if (!cancelled) {
        setTotalSeconds(0);
        setDay(d => d + 1); // triggers effect re-run for the new day
      }
    }, msUntilMidnight);

    return () => {
      cancelled = true;
      if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
      if (midnightRef.current) { clearTimeout(midnightRef.current); midnightRef.current = null; }
    };
  }, [timezone, day, sessions]); // re-runs on tz change, day rollover, or when the session set changes

  return totalSeconds;
}

/**
 * Returns milliseconds from now until the next midnight in the given IANA timezone.
 */
function getMsUntilMidnight(timezone: string): number {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(now);

  const get = (type: string) => parseInt(parts.find(p => p.type === type)?.value ?? '0', 10);
  const hour = get('hour');
  const min  = get('minute');
  const sec  = get('second');

  const elapsedMs = (hour * 3600 + min * 60 + sec) * 1000;
  return 24 * 60 * 60 * 1000 - elapsedMs;
}
