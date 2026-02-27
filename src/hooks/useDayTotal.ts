'use client';

import { useState, useEffect, useRef } from 'react';
import { getTodaySessions } from '@/lib/localBuffer';
import { parseBuffer } from '@/lib/parseBuffer';

/**
 * Returns the total "time worked" seconds tracked today (in the user's timezone),
 * summed across all sessions whose clock-in falls within today's calendar day.
 *
 * Counts: working + idle (only when includeIdleTime is true).
 * Excludes: break time and pause time.
 *
 * - Ticks every second.
 * - Resets automatically at midnight in the user's timezone by re-running the
 *   effect (driven by a `day` state that increments at midnight).
 */
export function useDayTotal(timezone: string, includeIdleTime: boolean): number {
  const [totalSeconds, setTotalSeconds] = useState(0);
  // Incrementing this triggers the effect to re-run after midnight
  const [day, setDay] = useState(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const midnightRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!timezone) return;

    let cancelled = false;

    async function compute() {
      const sessions = await getTodaySessions(timezone);
      const now = Date.now();
      let total = 0;
      for (const buf of sessions) {
        const t = parseBuffer(buf.events, now);
        total += t.workingSeconds + t.breakSeconds + (includeIdleTime ? t.idleSeconds : 0);
      }
      if (!cancelled) setTotalSeconds(total);
    }

    compute();
    tickRef.current = setInterval(compute, 1000);

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
  }, [timezone, includeIdleTime, day]); // re-runs on timezone change, setting change, or day rollover

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
