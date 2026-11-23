/**
 * Today's sessions → coloured spans, for the time-tracking page's ring and its
 * Sessions list. Pure.
 *
 * Moved here from the old `TodayTimeline` (a 24h bar) and extended with one
 * kind it could not tell apart: a pause the system inserted because there was
 * no evidence the app was running (`no-evidence`, time-tracking.md §3h) or the
 * machine slept (`sleep-gap`). Those are "not counted", not a pause the person
 * chose, and they draw as the grey hatch Shift Management uses for unknown time.
 */

import { STATE_CONFIG } from '@/lib/stateColors';
import { todaySessionCloseMs, type TodaySession } from '@/hooks/useTodaySessions';
import type { SessionEvent } from '@/types/firestore';

export type SegmentKind = 'working' | 'idle' | 'break' | 'pause' | 'not-counted';

export interface Segment {
  kind: SegmentKind;
  startMs: number;
  endMs: number;
}

/** Colours come from the timer's own palette — never re-typed (DESIGN.md §2). */
export const SEGMENT_COLOR: Record<Exclude<SegmentKind, 'not-counted'>, string> = {
  working: STATE_CONFIG.working.color,
  idle: STATE_CONFIG.idle.color,
  break: STATE_CONFIG['on-break'].color,
  pause: STATE_CONFIG.paused.color,
};

/** Grey hatch ink for time the app could not vouch for — Shift Management's unknown fill. */
export const NOT_COUNTED_INK = 'rgba(161,161,170,0.45)';

export const SEGMENT_LABEL: Record<SegmentKind, string> = {
  working: 'Working',
  idle: 'Idle',
  break: 'Break',
  pause: 'Paused',
  'not-counted': 'Not counted',
};

/** Display order for breakdowns and legends. */
export const SEGMENT_KINDS: SegmentKind[] = ['working', 'break', 'idle', 'pause', 'not-counted'];

const NOT_COUNTED_TRIGGERS = new Set(['no-evidence', 'sleep-gap']);

function isSystemPause(ev: SessionEvent): boolean {
  const trigger = ev.meta?.trigger;
  return typeof trigger === 'string' && NOT_COUNTED_TRIGGERS.has(trigger);
}

export function buildSegments(events: SessionEvent[], closeMs: number): Segment[] {
  const segments: Segment[] = [];
  let workingStart: number | null = null;
  let idleStart: number | null = null;
  let breakStart: number | null = null;
  let pauseStart: number | null = null;
  let pauseKind: SegmentKind = 'pause';

  const push = (kind: SegmentKind, start: number | null, end: number) => {
    if (start !== null && end > start) segments.push({ kind, startMs: start, endMs: end });
  };
  const closeAll = (t: number) => {
    push('working', workingStart, t); workingStart = null;
    push('idle', idleStart, t); idleStart = null;
    push('break', breakStart, t); breakStart = null;
    push(pauseKind, pauseStart, t); pauseStart = null;
  };

  for (const ev of events) {
    const t = ev.timestamp;
    switch (ev.type) {
      case 'clock-in':
      case 'resume':
        closeAll(t);
        workingStart = t;
        break;
      case 'idle-start':
        push('working', workingStart, t); workingStart = null;
        idleStart = t;
        break;
      case 'idle-end':
        push('idle', idleStart, t); idleStart = null;
        workingStart = t;
        break;
      case 'break-start':
        push('working', workingStart, t); workingStart = null;
        breakStart = t;
        break;
      case 'break-end':
        push('break', breakStart, t); breakStart = null;
        workingStart = t;
        break;
      case 'pause':
        push('working', workingStart, t); workingStart = null;
        pauseStart = t;
        pauseKind = isSystemPause(ev) ? 'not-counted' : 'pause';
        break;
      case 'clock-out':
        closeAll(t);
        break;
    }
  }
  closeAll(closeMs);
  return segments.sort((a, b) => a.startMs - b.startMs);
}

/**
 * Segments for one of today's sessions. An empty event log is *unknown*, not
 * "worked the whole span" (time-tracking.md, analytics trap 1), so it draws
 * nothing — except a manual entry, whose stored span IS the worked time (trap 7).
 */
export function sessionSegments(session: TodaySession, nowMs: number): Segment[] {
  if (session.events.length === 0) {
    if (session.isManual && session.endTime !== null) {
      return [{ kind: 'working', startMs: session.startTime, endMs: session.endTime }];
    }
    return [];
  }
  return buildSegments(session.events, todaySessionCloseMs(session, nowMs));
}

/** Seconds per kind across a set of segments. */
export function totalsByKind(segments: ReadonlyArray<Segment>): Record<SegmentKind, number> {
  const out: Record<SegmentKind, number> = { working: 0, idle: 0, break: 0, pause: 0, 'not-counted': 0 };
  for (const s of segments) out[s.kind] += Math.max(0, Math.round((s.endMs - s.startMs) / 1000));
  return out;
}

/**
 * Adjacent same-kind segments whose seam falls in the same minute read as one
 * span to a person, so hover and lists report the merged range.
 */
export function coalesce(segments: ReadonlyArray<Segment>): Segment[] {
  const out: Segment[] = [];
  for (const s of segments) {
    const last = out.at(-1);
    if (last && last.kind === s.kind && Math.floor(last.endMs / 60000) === Math.floor(s.startMs / 60000)) {
      last.endMs = Math.max(last.endMs, s.endMs);
    } else {
      out.push({ ...s });
    }
  }
  return out;
}

/** "4h 12m" / "38m" / "0m" — durations on this page are never seconds. */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h === 0) return `${m}m`;
  return `${h}h ${String(m).padStart(2, '0')}m`;
}
