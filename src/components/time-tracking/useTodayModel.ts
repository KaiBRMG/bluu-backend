'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTodaySessions, type TodaySession } from '@/hooks/useTodaySessions';
import { useMyShift } from '@/hooks/useMyShift';
import { pickTodayShift, type ShiftSpan } from '@/lib/shiftSpans';
import { getDayBoundsUTC, todayStr } from '@/lib/utils/timezone';
import { sessionSegments, totalsByKind, type Segment, type SegmentKind } from '@/lib/timesheet/daySegments';

const HOUR = 60 * 60 * 1000;
/** With no shift, the ring spans a working day from the first clock-in. */
const DEFAULT_SPAN_MS = 8 * HOUR;

export interface TodaySessionModel {
  session: TodaySession;
  segments: Segment[];
}

export interface TodayModel {
  /** The minute clock this model was computed against (ms). */
  now: number;
  sessions: TodaySessionModel[];
  segments: Segment[];
  totals: Record<SegmentKind, number>;
  shift: ShiftSpan | null;
  /** What the ring's arc covers; null on an empty day with no shift. */
  span: ShiftSpan | null;
  loading: boolean;
}

/**
 * Everything the page draws about today, at minute resolution.
 *
 * The arc and the lists move at most once a minute (plus immediately on any
 * state transition, since that changes `sessions`); the hero clock is the only
 * per-second figure on the page and is not read from here.
 */
export function useTodayModel(timezone: string): TodayModel {
  const { sessions, loading: sessionsLoading } = useTodaySessions(timezone);
  const { shifts, loading: shiftLoading } = useMyShift();

  const [tick, setTick] = useState(() => Date.now());
  useEffect(() => {
    // Align to the minute so the arc steps with the clock's minute digit.
    let id: ReturnType<typeof setInterval> | undefined;
    const t = setTimeout(() => {
      setTick(Date.now());
      id = setInterval(() => setTick(Date.now()), 60_000);
    }, 60_000 - (Date.now() % 60_000));
    return () => { clearTimeout(t); if (id) clearInterval(id); };
  }, []);
  return useMemo(() => {
    // A transition must show at once, not at the next minute tick: it appends an
    // event stamped "now", so never close the live session before its newest event.
    let now = tick;
    for (const s of sessions) {
      if (s.isLive) for (const ev of s.events) if (ev.timestamp > now) now = ev.timestamp;
    }
    const sessionModels = sessions
      .map(session => ({ session, segments: sessionSegments(session, now) }))
      .sort((a, b) => a.session.startTime - b.session.startTime);
    const segments = sessionModels.flatMap(s => s.segments);

    const { start: dayStart, end: dayEnd } = getDayBoundsUTC(todayStr(timezone), timezone);
    const shift = pickTodayShift(shifts, now, dayStart, dayEnd);
    const isLive = sessions.some(s => s.isLive);

    let first: number | null = null;
    let last: number | null = null;
    for (const s of segments) {
      if (first === null || s.startMs < first) first = s.startMs;
      if (last === null || s.endMs > last) last = s.endMs;
    }

    let span: ShiftSpan | null = null;
    if (shift) {
      span = {
        start: Math.min(shift.start, first ?? shift.start),
        end: Math.max(shift.end, last ?? shift.end, isLive ? now : shift.end),
      };
    } else if (first !== null && last !== null) {
      const start = Math.floor(first / HOUR) * HOUR;
      span = { start, end: Math.max(start + DEFAULT_SPAN_MS, Math.ceil(last / HOUR) * HOUR) };
    }

    return {
      now,
      sessions: sessionModels,
      segments,
      totals: totalsByKind(segments),
      shift,
      span,
      loading: sessionsLoading || shiftLoading,
    };
  }, [sessions, shifts, tick, timezone, sessionsLoading, shiftLoading]);
}
