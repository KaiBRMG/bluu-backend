import type { SessionEvent, ParsedSessionTotals } from '@/types/firestore';

/**
 * Walk the event log and compute total working/idle/break/pause seconds.
 *
 * Rules:
 * - Time between 'clock-in' (or 'resume' after idle/pause) and the next
 *   non-working event is working time.
 * - Time between 'idle-start' and 'idle-end' is idle time.
 * - Time between 'break-start' and 'break-end' is break time.
 * - Time between 'pause' and 'resume' is pause time.
 * - 'clock-out' closes the last open working segment.
 *
 * If no 'clock-out' event exists (live elapsed calculation or interrupted session),
 * open segments are closed against `nowMs` (defaults to Date.now()).
 */
export function parseBuffer(events: SessionEvent[], nowMs?: number): ParsedSessionTotals {
  const totals: ParsedSessionTotals = {
    workingSeconds: 0,
    idleSeconds: 0,
    breakSeconds: 0,
    pauseSeconds: 0,
  };

  if (events.length === 0) return totals;

  let workingStart: number | null = null;
  let idleStart: number | null = null;
  let breakStart: number | null = null;
  let pauseStart: number | null = null;

  for (const event of events) {
    const t = event.timestamp;

    switch (event.type) {
      case 'clock-in':
      case 'resume':
        workingStart = t;
        idleStart = null;
        breakStart = null;
        pauseStart = null;
        break;

      case 'idle-start':
        if (workingStart !== null) {
          totals.workingSeconds += Math.floor((t - workingStart) / 1000);
          workingStart = null;
        }
        idleStart = t;
        break;

      case 'idle-end':
        if (idleStart !== null) {
          totals.idleSeconds += Math.floor((t - idleStart) / 1000);
          idleStart = null;
        }
        workingStart = t;
        break;

      case 'break-start':
        if (workingStart !== null) {
          totals.workingSeconds += Math.floor((t - workingStart) / 1000);
          workingStart = null;
        }
        breakStart = t;
        break;

      case 'break-end':
        if (breakStart !== null) {
          totals.breakSeconds += Math.floor((t - breakStart) / 1000);
          breakStart = null;
        }
        workingStart = t;
        break;

      case 'pause':
        if (workingStart !== null) {
          totals.workingSeconds += Math.floor((t - workingStart) / 1000);
          workingStart = null;
        }
        pauseStart = t;
        break;

      case 'clock-out':
        if (workingStart !== null) {
          totals.workingSeconds += Math.floor((t - workingStart) / 1000);
          workingStart = null;
        }
        if (idleStart !== null) {
          totals.idleSeconds += Math.floor((t - idleStart) / 1000);
          idleStart = null;
        }
        if (breakStart !== null) {
          totals.breakSeconds += Math.floor((t - breakStart) / 1000);
          breakStart = null;
        }
        if (pauseStart !== null) {
          totals.pauseSeconds += Math.floor((t - pauseStart) / 1000);
          pauseStart = null;
        }
        break;

      case 'activity':
      case 'screenshot':
        break;
    }
  }

  // Close any open segments against nowMs (live elapsed or interrupted session)
  const now = nowMs ?? Date.now();
  if (workingStart !== null) totals.workingSeconds += Math.floor((now - workingStart) / 1000);
  if (idleStart !== null)    totals.idleSeconds    += Math.floor((now - idleStart)    / 1000);
  if (breakStart !== null)   totals.breakSeconds   += Math.floor((now - breakStart)   / 1000);
  if (pauseStart !== null)   totals.pauseSeconds   += Math.floor((now - pauseStart)   / 1000);

  return totals;
}
