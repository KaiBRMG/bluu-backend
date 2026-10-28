'use client';

import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { milestonesFor } from '@/lib/training/modules';
import { fmtRemaining } from '../_lib/format';
import { CLOCK_PHASE, phaseFor } from '../_lib/theme';

function spoken(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  return minutes <= 1 ? 'One minute left.' : `${minutes} minutes left.`;
}

interface CountdownProps {
  /** Server timestamp the part ends. */
  deadlineMs: number;
  durationMs: number;
  /** Server-aligned "now" — see `useServerClock`. */
  now: () => number;
  onExpire: () => void;
  /** Progress and the early-finish control, laid out beside / under the numerals. */
  children?: React.ReactNode;
  className?: string;
}

/**
 * The clock: the largest thing on the task screen, and the reason the screen
 * exists. Below `lg` it is a pinned band (numerals left, the page's actions
 * right); from `lg` it is a rail card with the numerals at their full size.
 *
 * It only ever RENDERS a server deadline — nothing here can move it. State
 * updates once a second (on the second boundary, polled at 250ms so a slow
 * tick never shows a repeated number), plus a single pulse at each milestone
 * and a continuous flash in the last minute. Words and the border carry every
 * phase, so reduced motion (which removes the animation) loses nothing.
 *
 * Announcements go to ONE polite live region and only at milestones — a timer
 * that speaks every second makes the page unusable with a screen reader.
 */
export function Countdown({ deadlineMs, durationMs, now, onExpire, children, className }: CountdownProps) {
  const [remaining, setRemaining] = useState(() => Math.max(0, deadlineMs - now()));
  const [pulseKey, setPulseKey] = useState(0);
  const [announcement, setAnnouncement] = useState('');
  const fired = useRef(new Set<number>());
  const expired = useRef(false);
  // Always calls the latest `onExpire` without making the interval depend on it.
  const expire = useEffectEvent(onExpire);

  useEffect(() => {
    const milestones = milestonesFor(durationMs);
    const tick = () => {
      const left = Math.max(0, deadlineMs - now());
      setRemaining((prev) => (Math.ceil(prev / 1000) === Math.ceil(left / 1000) ? prev : left));

      for (const m of milestones) {
        // Fire a milestone once, and only if we are within a few seconds of it —
        // a candidate who reloads at 4:00 must not be told "10 minutes left".
        if (left <= m && left > m - 4_000 && !fired.current.has(m)) {
          fired.current.add(m);
          setPulseKey((k) => k + 1);
          setAnnouncement(spoken(m));
        }
      }
      if (left <= 60_000 && left > 56_000 && !fired.current.has(60_000)) {
        fired.current.add(60_000);
        setAnnouncement('Last minute.');
      }
      if (left <= 0 && !expired.current) {
        expired.current = true;
        setAnnouncement("Time's up.");
        expire();
      }
    };
    tick();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [deadlineMs, durationMs, now]);

  const phase = phaseFor(remaining);
  const look = CLOCK_PHASE[phase];
  const motion = phase === 'last' ? 'training-flash' : phase === 'over' ? '' : pulseKey > 0 ? 'training-pulse' : '';

  return (
    <section
      aria-label="Time remaining"
      className={cn(
        'sticky top-0 z-20 -mx-5 flex items-center justify-between gap-4 border-b bg-[#08090b] px-5 py-3 sm:-mx-8 sm:px-8',
        'lg:top-8 lg:mx-0 lg:flex-col lg:items-stretch lg:gap-5 lg:rounded-2xl lg:border lg:bg-white/[0.025] lg:p-6',
        look.box,
        className,
      )}
    >
      <div>
        <p className="text-xs font-medium text-white/70 lg:text-sm">{look.label}</p>
        <div
          role="timer"
          aria-live="off"
          key={phase === 'last' ? 'last' : pulseKey}
          className={cn(
            'font-bold tabular-nums leading-none',
            'text-[2.5rem] sm:text-5xl lg:text-[5.75rem]',
            look.digits,
            motion,
          )}
        >
          {fmtRemaining(remaining)}
        </div>
      </div>
      <div className="sr-only" role="status" aria-live="polite">
        {announcement}
      </div>
      {children}
    </section>
  );
}

/** "Opens in 2h 14m" — ticks once a second, calls `onOpen` at zero. */
export function OpensIn({ opensAtMs, now, onOpen }: { opensAtMs: number; now: () => number; onOpen: () => void }) {
  const [left, setLeft] = useState(() => opensAtMs - now());
  const opened = useEffectEvent(onOpen);
  const fired = useRef(false);

  useEffect(() => {
    const tick = () => {
      const remaining = opensAtMs - now();
      setLeft(remaining);
      if (remaining <= 0 && !fired.current) {
        fired.current = true;
        opened();
      }
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [opensAtMs, now]);

  const total = Math.max(0, Math.ceil(left / 1000));
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const text =
    d > 0 ? `${d}d ${h}h ${m}m` : h > 0 ? `${h}h ${m}m ${String(s).padStart(2, '0')}s` : `${m}m ${String(s).padStart(2, '0')}s`;

  return <span className="tabular-nums">{text}</span>;
}
