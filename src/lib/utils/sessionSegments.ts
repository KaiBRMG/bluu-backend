import type { SessionEvent, TimeEntryLedgerDocument } from '@/types/firestore';

// ─── Segment types ───────────────────────────────────────────────────

export type SegmentState = 'working' | 'idle' | 'on-break' | 'paused';

export interface SegmentRow {
  id: string;
  /** Ledger doc id the segment was decomposed from — lets the UI open the session it belongs to. */
  sessionId: string;
  state: SegmentState;
  createdTime: string;
  lastTime: string;
}

/** A single decoded stretch of session time, in absolute epoch ms. */
export interface SegmentSpan {
  state: SegmentState;
  startMs: number;
  endMs: number;
}

/**
 * One whole session as the timesheet API sends it to the client: the ledger's
 * headline figures plus the verbatim event log the desktop client uploaded.
 * Serialisable — Timestamps are already ISO strings.
 */
export interface TimesheetSessionPayload {
  sessionId: string;
  startTime: string;
  endTime: string;
  status: 'completed' | 'interrupted';
  didNotClockOut: boolean;
  isManual: boolean;
  workingSeconds: number;
  idleSeconds: number;
  breakSeconds: number;
  pauseSeconds: number;
  events: SessionEvent[];
}

// ─── Session → segment decomposition ────────────────────────────────

/**
 * Pure core of the decomposition: walk an event log and emit the working /
 * idle / on-break / paused spans it describes, bounded by the session's own
 * start and end.
 *
 * Shared by `sessionToSegments` (the timesheet bars, server-side) and the
 * session walkthrough dialog (client-side) so the two renderings of the same
 * session can never disagree.
 *
 * **An empty log returns `[]`, not one full working span.** "No events" means
 * *unknown*, not "worked the whole time" — see the analytics traps in
 * documentation/time-tracking.md. Callers decide how to present that absence;
 * `sessionToSegments` keeps its own legacy full-working fallback for the
 * timesheet bars.
 */
export function eventsToSegments(
  events: SessionEvent[] | undefined | null,
  sessionStartMs: number,
  sessionEndMs: number,
): SegmentSpan[] {
  if (!events || events.length === 0) return [];

  const spans: SegmentSpan[] = [];
  const emit = (state: SegmentState, startMs: number, endMs: number) => {
    if (endMs <= startMs) return;
    spans.push({ state, startMs, endMs });
  };

  let segStart = sessionStartMs;
  let idleStart: number | null = null;
  let breakStart: number | null = null;
  let pauseStart: number | null = null;

  for (const event of events) {
    const t = event.timestamp;

    switch (event.type) {
      case 'idle-start':
        emit('working', segStart, t);
        segStart = t;
        idleStart = t;
        break;
      case 'idle-end':
        if (idleStart !== null) emit('idle', idleStart, t);
        idleStart = null;
        segStart = t;
        break;
      case 'break-start':
        emit('working', segStart, t);
        segStart = t;
        breakStart = t;
        break;
      case 'break-end':
        if (breakStart !== null) emit('on-break', breakStart, t);
        breakStart = null;
        segStart = t;
        break;
      case 'pause':
        emit('working', segStart, t);
        segStart = t;
        pauseStart = t;
        break;
      case 'resume':
        if (pauseStart !== null) emit('paused', pauseStart, t);
        pauseStart = null;
        segStart = t;
        break;
      case 'clock-out':
        if (idleStart !== null) { emit('idle', idleStart, t); idleStart = null; }
        else if (breakStart !== null) { emit('on-break', breakStart, t); breakStart = null; }
        else if (pauseStart !== null) { emit('paused', pauseStart, t); pauseStart = null; }
        else emit('working', segStart, t);
        segStart = t;
        break;
      default:
        break;
    }
  }

  if (idleStart !== null) emit('idle', idleStart, sessionEndMs);
  else if (breakStart !== null) emit('on-break', breakStart, sessionEndMs);
  else if (pauseStart !== null) emit('paused', pauseStart, sessionEndMs);
  else if (segStart < sessionEndMs) emit('working', segStart, sessionEndMs);

  return spans;
}

/**
 * Decompose a TimeEntryLedgerDocument's event log into flat segment rows
 * (working / idle / on-break / paused). Used by the entries API route to
 * produce the format expected by TimesheetView / DayTimeline.
 */
export function sessionToSegments(
  sessionId: string,
  data: TimeEntryLedgerDocument,
): SegmentRow[] {
  const events = data.eventLog;

  // Legacy fallback for the timesheet bars only: a logless session still has to
  // draw as *something* across its span. The walkthrough dialog renders this
  // same absence honestly, as unknown rather than working.
  if (!events || events.length === 0) {
    return [{
      id: sessionId,
      sessionId,
      state: 'working',
      createdTime: data.startTime.toDate().toISOString(),
      lastTime: data.endTime.toDate().toISOString(),
    }];
  }

  return eventsToSegments(events, data.startTime.toMillis(), data.endTime.toMillis())
    .map((span, i) => ({
      id: `${sessionId}_${i}`,
      sessionId,
      state: span.state,
      createdTime: new Date(span.startMs).toISOString(),
      lastTime: new Date(span.endMs).toISOString(),
    }));
}

// ─── Time-worked computation clipped to a window ─────────────────────

/**
 * Given a session's event log and its absolute start/end times, compute
 * how many seconds of "worked" time fall within [windowStartMs, windowEndMs].
 * Idle and pause time are excluded; break time is included (breaks are part
 * of the total reported worked time).
 *
 * Used by the shifts/week API route to calculate "Time worked" for a
 * past shift without re-querying Firestore per shift.
 */
export function computeWorkedInWindow(
  eventLog: SessionEvent[],
  sessionStartMs: number,
  sessionEndMs: number,
  windowStartMs: number,
  windowEndMs: number,
): number {
  // Clip the session itself to the window first
  const clippedSessionStart = Math.max(sessionStartMs, windowStartMs);
  const clippedSessionEnd   = Math.min(sessionEndMs,   windowEndMs);
  if (clippedSessionEnd <= clippedSessionStart) return 0;

  // If there is no event log, treat the entire (clipped) session as working
  if (!eventLog || eventLog.length === 0) {
    return Math.round((clippedSessionEnd - clippedSessionStart) / 1000);
  }

  let total = 0;

  // Walk the segments produced by the event log and clip each to the window
  const addSeconds = (startMs: number, endMs: number, isIdle: boolean) => {
    if (isIdle) return;
    const s = Math.max(startMs, windowStartMs);
    const e = Math.min(endMs,   windowEndMs);
    if (e > s) total += Math.round((e - s) / 1000);
  };

  let segStart = sessionStartMs;
  let idleStart: number | null = null;
  let breakStart: number | null = null;
  let pauseStart: number | null = null;

  for (const event of eventLog) {
    const t = event.timestamp;

    switch (event.type) {
      case 'idle-start':
        addSeconds(segStart, t, false);  // working segment up to idle
        segStart = t;
        idleStart = t;
        break;
      case 'idle-end':
        if (idleStart !== null) addSeconds(idleStart, t, true);  // idle segment
        idleStart = null;
        segStart = t;
        break;
      case 'break-start':
        addSeconds(segStart, t, false);
        segStart = t;
        breakStart = t;
        break;
      case 'break-end':
        if (breakStart !== null) addSeconds(breakStart, t, false);
        breakStart = null;
        segStart = t;
        break;
      case 'pause':
        addSeconds(segStart, t, false);
        segStart = t;
        pauseStart = t;
        break;
      case 'resume':
        // Pause time is not counted as worked time
        pauseStart = null;
        segStart = t;
        break;
      case 'clock-out':
        if (idleStart !== null) { addSeconds(idleStart, t, true); idleStart = null; }
        else if (breakStart !== null) { addSeconds(breakStart, t, false); breakStart = null; }
        else if (pauseStart !== null) { pauseStart = null; }
        else addSeconds(segStart, t, false);
        segStart = t;
        break;
      default:
        break;
    }
  }

  // Close any open segment against the session end (clipped to window)
  const endMs = sessionEndMs;
  if (idleStart !== null) addSeconds(idleStart, endMs, true);
  else if (breakStart !== null) addSeconds(breakStart, endMs, false);
  else if (pauseStart !== null) { /* pause not counted */ }
  else addSeconds(segStart, endMs, false);

  return total;
}
