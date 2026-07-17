import { computeWorkedInWindow } from '@/lib/utils/sessionSegments';
import type {
  TimeEntryLedgerDocument,
  ActiveSessionDocument,
  CompactSegment,
} from '@/types/firestore';
import { SEG_WORKING, SEG_BREAK } from '@/types/firestore';

export type AttendanceStatus = 'on-time' | 'late' | 'absent';

// Attendance thresholds (hardcoded per spec)
export const ON_TIME_BEFORE_MS = 15 * 60 * 1000;   // 15 min before shift start
export const LATE_AFTER_MS     = 30 * 60 * 1000;   // 30 min after shift start

/**
 * Collect the clock-in times that count toward a shift's attendance.
 *
 * A session counts if it started inside the attendance window, or if it started
 * before the window but was still running at shift start (e.g. carrying over
 * from a back-to-back shift) — the latter is credited at `shiftStartMs`.
 */
function collectClockIns(
  shiftStartMs: number,
  shiftEndMs: number,
  bounds: Array<[number, number]>,
): number[] {
  const onTimeFrom = shiftStartMs - ON_TIME_BEFORE_MS;
  const clockIns: number[] = [];

  for (const [startMs, endMs] of bounds) {
    if (startMs >= onTimeFrom && startMs <= shiftEndMs) {
      clockIns.push(startMs);
    } else if (startMs < onTimeFrom && endMs > shiftStartMs) {
      clockIns.push(shiftStartMs);
    }
  }

  return clockIns;
}

/** Classify a set of clock-in times against a shift start. */
function classify(shiftStartMs: number, clockIns: number[]): AttendanceStatus {
  if (clockIns.length === 0) return 'absent';
  const first = Math.min(...clockIns);
  return first <= shiftStartMs + LATE_AFTER_MS ? 'on-time' : 'late';
}

export function computeAttendance(
  shiftStartMs: number,
  shiftEndMs: number,
  sessions: TimeEntryLedgerDocument[],
  activeSession: ActiveSessionDocument | undefined,
): AttendanceStatus {
  const onTimeFrom = shiftStartMs - ON_TIME_BEFORE_MS;

  const bounds: Array<[number, number]> = sessions.map(s => [
    s.startTime.toMillis(),
    s.endTime.toMillis(),
  ]);
  const clockIns = collectClockIns(shiftStartMs, shiftEndMs, bounds);

  if (activeSession) {
    const startMs = activeSession.startTime.toMillis();
    if (startMs >= onTimeFrom && startMs <= shiftEndMs) {
      clockIns.push(startMs);
    } else if (startMs < onTimeFrom) {
      // Active session started before the window and is still running — was
      // present at shift start, treat as on time
      clockIns.push(shiftStartMs);
    }
  }

  return classify(shiftStartMs, clockIns);
}

export function computeTimeWorked(
  shiftStartMs: number,
  shiftEndMs: number,
  sessions: TimeEntryLedgerDocument[],
  activeSession: ActiveSessionDocument | undefined,
): number {
  let total = 0;

  for (const s of sessions) {
    const sessionStartMs = s.startTime.toMillis();
    const sessionEndMs   = s.endTime.toMillis();
    // Skip sessions that don't overlap the shift window
    if (sessionEndMs <= shiftStartMs || sessionStartMs >= shiftEndMs) continue;

    total += computeWorkedInWindow(
      s.eventLog,
      sessionStartMs,
      sessionEndMs,
      shiftStartMs,
      shiftEndMs,
    );
  }

  // If there's an active (not yet clocked out) session overlapping the shift
  if (activeSession && !activeSession.userClockOut) {
    const sessionStartMs = activeSession.startTime.toMillis();
    const sessionEndMs   = Math.min(Date.now(), shiftEndMs);
    if (sessionEndMs > shiftStartMs && sessionStartMs < shiftEndMs) {
      // No eventLog available for active sessions — count all time as working
      const clippedStart = Math.max(sessionStartMs, shiftStartMs);
      const clippedEnd   = Math.min(sessionEndMs,   shiftEndMs);
      if (clippedEnd > clippedStart) {
        total += Math.round((clippedEnd - clippedStart) / 1000);
      }
    }
  }

  return total;
}

// ─── Rollup variants (analytics_daily) ───────────────────────────────
// The analytics dashboard reads precomputed daily rollups rather than raw
// ledger documents, so it needs the same two computations expressed over the
// rollup's compact `sessionBounds` / `segments` instead of Firestore docs.
// Rollups only ever cover past days, so there is no active-session case.

export function computeAttendanceFromBounds(
  shiftStartMs: number,
  shiftEndMs: number,
  sessionBounds: Array<[number, number]>,
): AttendanceStatus {
  return classify(shiftStartMs, collectClockIns(shiftStartMs, shiftEndMs, sessionBounds));
}

/**
 * Worked seconds inside a window, from a rollup's compact segments.
 *
 * Mirrors `computeWorkedInWindow`'s semantics exactly: idle and pause are
 * excluded, break IS included (breaks are part of reported worked time).
 */
export function computeWorkedInWindowFromSegments(
  segments: CompactSegment[],
  windowStartMs: number,
  windowEndMs: number,
): number {
  let total = 0;
  for (const [startMs, endMs, code] of segments) {
    if (code !== SEG_WORKING && code !== SEG_BREAK) continue;
    const s = Math.max(startMs, windowStartMs);
    const e = Math.min(endMs,   windowEndMs);
    if (e > s) total += Math.round((e - s) / 1000);
  }
  return total;
}
