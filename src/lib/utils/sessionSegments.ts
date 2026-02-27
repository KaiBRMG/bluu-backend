import type { SessionEvent, TimeEntryLedgerDocument } from '@/types/firestore';

// ─── Segment types ───────────────────────────────────────────────────

export interface SegmentRow {
  id: string;
  state: 'working' | 'idle' | 'on-break' | 'paused';
  createdTime: string;
  lastTime: string;
}

// ─── Session → segment decomposition ────────────────────────────────

/**
 * Decompose a TimeEntryLedgerDocument's event log into flat segment rows
 * (working / idle / on-break / paused). Used by the entries API route to
 * produce the format expected by TimesheetView / DayTimeline.
 */
export function sessionToSegments(
  sessionId: string,
  data: TimeEntryLedgerDocument,
): SegmentRow[] {
  const segments: SegmentRow[] = [];
  const events = data.eventLog;

  if (!events || events.length === 0) {
    segments.push({
      id: sessionId,
      state: 'working',
      createdTime: data.startTime.toDate().toISOString(),
      lastTime: data.endTime.toDate().toISOString(),
    });
    return segments;
  }

  let segStart = data.startTime.toMillis();
  let segIdx = 0;

  const emit = (
    state: SegmentRow['state'],
    startMs: number,
    endMs: number,
  ) => {
    if (endMs <= startMs) return;
    segments.push({
      id: `${sessionId}_${segIdx++}`,
      state,
      createdTime: new Date(startMs).toISOString(),
      lastTime: new Date(endMs).toISOString(),
    });
  };

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

  const endMs = data.endTime.toMillis();
  if (idleStart !== null) emit('idle', idleStart, endMs);
  else if (breakStart !== null) emit('on-break', breakStart, endMs);
  else if (pauseStart !== null) emit('paused', pauseStart, endMs);
  else if (segStart < endMs) emit('working', segStart, endMs);

  return segments;
}

// ─── Time-worked computation clipped to a window ─────────────────────

/**
 * Given a session's event log and its absolute start/end times, compute
 * how many seconds of "worked" time (working + optionally idle) fall
 * within [windowStartMs, windowEndMs].
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
  includeIdleTime: boolean,
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
    if (isIdle && !includeIdleTime) return;
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
        // Break time is not counted as worked time
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
        else if (breakStart !== null) { breakStart = null; }
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
  else if (breakStart !== null) { /* break not counted */ }
  else if (pauseStart !== null) { /* pause not counted */ }
  else addSeconds(segStart, endMs, false);

  return total;
}
