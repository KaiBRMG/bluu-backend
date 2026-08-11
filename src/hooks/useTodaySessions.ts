'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useTimeTracking } from '@/hooks/useTimeTracking';
import { useTimesheetData } from '@/hooks/useTimesheetData';
import { getTodaySessions } from '@/lib/localBuffer';
import { parseBuffer, sessionCloseMs } from '@/lib/parseBuffer';
import { todayStr } from '@/lib/utils/timezone';
import type { SessionEvent } from '@/types/firestore';

/**
 * One of today's sessions, from EITHER source.
 *
 * The local IndexedDB buffer only ever holds sessions tracked on THIS device.
 * A user who clocks out on device A and then clocks in on device B has both
 * sessions on the server (`time_entries` is keyed by uid) but only the second
 * one locally — so a local-only read shows device B a day that is missing all
 * of device A's hours. Merging the ledger in is what makes today's figures
 * device-independent.
 */
export interface TodaySession {
  sessionId: string;
  startTime: number;
  /** Committed sessions know when they ended; a live buffer does not. */
  endTime: number | null;
  events: SessionEvent[];
  /** `local` = this device's buffer; `ledger` = committed server-side, from any device. */
  source: 'local' | 'ledger';
  /** True only for the session the timer is currently running (open segments grow to now). */
  isLive: boolean;
  isManual: boolean;
  /** Stored aggregates — the only totals available when `events` is empty. */
  ledgerWorkedSeconds: number | null;
}

/**
 * The instant a session's open segments close.
 *
 * Delegates to `sessionCloseMs` (the single source of truth — see
 * time-tracking.md §2) and only adds the one case a local buffer cannot have:
 * a ledger session with an EMPTY event log, where the stored `endTime` is the
 * only boundary available.
 */
export function todaySessionCloseMs(session: TodaySession, now: number): number {
  if (session.events.length === 0 && session.endTime !== null) return session.endTime;
  return sessionCloseMs(session, session.isLive, now);
}

/**
 * Worked seconds for one session — `working + break`, idle and pause excluded.
 *
 * Both today's consumers (`useDayTotal` and `TodayTimeline`) MUST derive their
 * totals from this function so the timer page's "TODAY" and the timesheet's
 * "Total worked" cannot drift apart (time-tracking.md §2, total-worked invariant).
 *
 * An empty event log is *unknown*, never "worked the whole span" (analytics
 * trap 1), so it falls back to the stored aggregates rather than measuring the
 * gap between start and end: a manual entry contributes its real hours, while
 * an interrupted session the Cloud Function closed with zeroes contributes 0.
 */
export function todaySessionWorkedSeconds(session: TodaySession, now: number): number {
  if (session.events.length === 0) return session.ledgerWorkedSeconds ?? 0;
  const totals = parseBuffer(session.events, todaySessionCloseMs(session, now));
  return totals.workingSeconds + totals.breakSeconds;
}

interface UseTodaySessionsReturn {
  sessions: TodaySession[];
  /** True while today's ledger is still loading and no local buffer covers it. */
  loading: boolean;
}

/**
 * Every session belonging to today in the user's timezone, local buffers and
 * committed ledger docs merged and de-duplicated by `sessionId`.
 *
 * Precedence on a collision, in order:
 *   1. The LIVE session always comes from the local buffer — it is the only copy
 *      still growing, and the server has no ledger doc until clock-out.
 *   2. A ledger doc WITH an event log wins — it is the committed record, and for
 *      a session tracked here it was written from this very buffer anyway.
 *   3. Otherwise the local buffer wins: an empty-log ledger doc is a placeholder
 *      awaiting exactly this buffer's upload (see time-tracking.md §3b).
 */
export function useTodaySessions(timezone: string): UseTodaySessionsReturn {
  const { sessionId, displayState } = useTimeTracking();
  const [buffers, setBuffers] = useState<TodaySession[]>([]);
  // Both halves arrive asynchronously. Without this the first paint reports an
  // empty day, which reads as "you tracked nothing today" rather than "loading".
  const [buffersLoaded, setBuffersLoaded] = useState(false);

  const today = useMemo(() => todayStr(timezone), [timezone]);

  // Today's committed sessions from the server — this is the cross-device half.
  // Shares the timesheet cache (5 min TTL, cleared by `invalidateTimesheetCache`
  // on every clock-in/out) and its in-flight dedupe, so mounting this hook twice
  // on the timer page costs one query, not two.
  const { sessions: ledgerSessions, loading: ledgerLoading } = useTimesheetData(null, today, today, timezone);

  const loadBuffers = useCallback(async () => {
    const local = await getTodaySessions(timezone);
    setBuffers(
      local.map(buf => ({
        sessionId: buf.sessionId,
        startTime: buf.startTime,
        endTime: buf.events.find(e => e.type === 'clock-out')?.timestamp ?? null,
        events: buf.events,
        source: 'local' as const,
        isLive: false, // resolved against the live session below
        isManual: false,
        ledgerWorkedSeconds: null,
      })),
    );
    setBuffersLoaded(true);
  }, [timezone]);

  // Reload when the session changes or a state transition appends buffer events.
  useEffect(() => {
    loadBuffers();
  }, [loadBuffers, sessionId, displayState]);

  const sessions = useMemo(() => {
    const isLive = (sid: string) => sid === sessionId && displayState !== 'clocked-out';

    const merged = new Map<string, TodaySession>();

    for (const s of ledgerSessions) {
      merged.set(s.sessionId, {
        sessionId: s.sessionId,
        startTime: new Date(s.startTime).getTime(),
        endTime: new Date(s.endTime).getTime(),
        events: s.events,
        source: 'ledger',
        // A committed session is finished by definition. Guarding on isLive here
        // too would let a stale ledger doc re-open a session that has ended.
        isLive: false,
        isManual: s.isManual,
        ledgerWorkedSeconds: s.workingSeconds + s.breakSeconds,
      });
    }

    for (const buf of buffers) {
      const live = isLive(buf.sessionId);
      const ledger = merged.get(buf.sessionId);
      // The ledger copy wins for a committed session, EXCEPT when it carries no
      // event log — a placeholder reserved by /start or the cleanup CF (§3b), or
      // a doc whose merge has not landed yet. This buffer is the very log that
      // is about to fill it in, so showing 0 here would be wrong twice over.
      const ledgerWins = ledger !== undefined && ledger.events.length > 0;
      if (ledgerWins && !live) continue;
      merged.set(buf.sessionId, { ...buf, isLive: live });
    }

    return [...merged.values()].sort((a, b) => a.startTime - b.startTime);
  }, [ledgerSessions, buffers, sessionId, displayState]);

  // Only "loading" while there is genuinely nothing to show — once either half
  // has landed the view renders what it has and fills in the rest.
  return { sessions, loading: (ledgerLoading || !buffersLoaded) && sessions.length === 0 };
}
