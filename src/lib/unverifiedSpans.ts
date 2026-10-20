import type { SessionEvent } from '@/types/firestore';

/**
 * The longest a WORKING span may go without any event before it stops counting.
 *
 * While the timer is working the renderer writes evidence that it is running:
 * an `activity` heartbeat every 15 min (TimeTrackingContext's
 * HEARTBEAT_INTERVAL_MS, restarted at each return to working), a `screenshot`
 * marker per capture, and every state transition. A working gap wider than one
 * heartbeat plus slack therefore means the app was not running at all — the
 * machine slept without the renderer hearing `suspend`, or the process froze.
 *
 * Shared with the renderer's live sleep-gap check so the two can never
 * disagree about what counts as a gap. Keep it above the heartbeat period.
 */
export const UNVERIFIED_GAP_MS = 20 * 60 * 1000;

/** Offset of a synthetic `pause` from the last evidence — matches patchSleepGap and the rollup's heuristic. */
const SYNTHETIC_PAUSE_OFFSET_MS = 1000;

/** `meta.trigger` on the pause/resume pair this module injects. */
export const UNVERIFIED_TRIGGER = 'no-evidence';

/**
 * Set on an event by the renderer when the native 5s sampler proved the machine
 * was awake across the gap that event closes (`wasAwakeDuring`). The gap is then
 * real time on a running machine, not a sleep, and is kept.
 */
export const AWAKE_VERIFIED_META = 'awakeVerified';

export interface UnverifiedSpansResult {
  events: SessionEvent[];
  /** Working seconds the log claimed that no evidence supports — now paused. */
  unverifiedSeconds: number;
}

/**
 * Exclude every working span the app cannot prove it was running for.
 *
 * Walks the log and, wherever two consecutive events in a working span are more
 * than UNVERIFIED_GAP_MS apart, inserts a `pause` one second after the earlier
 * event and a `resume` at the later one, both tagged
 * `meta: { trigger: 'no-evidence' }`. The span then counts as pause — excluded
 * from worked time — in every consumer that reads the log (parseBuffer, the
 * timesheet segments, computeTimeWorked → payroll, the analytics rollup), with
 * no consumer needing to know this rule exists.
 *
 * - Only WORKING spans: idle, break and pause write no heartbeats by design.
 * - The pair is always closed by a `resume` placed before the later event, even
 *   when that event is a transition or the clock-out — an unclosed pause would
 *   leak into the following idle/break span in parseBuffer.
 * - Idempotent: a corrected log has no working gap left, so running it twice is
 *   a no-op. That is what lets every ledger write call it unconditionally.
 * - Pure, no I/O — the event log already carries every signal it reads.
 */
export function excludeUnverifiedSpans(events: SessionEvent[]): UnverifiedSpansResult {
  if (events.length < 2) return { events, unverifiedSeconds: 0 };

  const out: SessionEvent[] = [];
  let unverifiedMs = 0;
  let working = false;

  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    const prev = out.length > 0 ? out[out.length - 1] : null;

    if (
      working &&
      prev &&
      event.timestamp - prev.timestamp > UNVERIFIED_GAP_MS &&
      event.meta?.[AWAKE_VERIFIED_META] !== true
    ) {
      const pauseAt = prev.timestamp + SYNTHETIC_PAUSE_OFFSET_MS;
      const gapMs = event.timestamp - pauseAt;
      out.push({ type: 'pause', timestamp: pauseAt, meta: { trigger: UNVERIFIED_TRIGGER, gapMs } });
      out.push({ type: 'resume', timestamp: event.timestamp, meta: { trigger: UNVERIFIED_TRIGGER } });
      unverifiedMs += gapMs;
    }

    out.push(event);

    switch (event.type) {
      case 'clock-in':
      case 'resume':
      case 'idle-end':
      case 'break-end':
        working = true;
        break;
      case 'idle-start':
      case 'break-start':
      case 'pause':
      case 'clock-out':
        working = false;
        break;
      // 'activity' / 'screenshot' are evidence, not transitions
    }
  }

  if (unverifiedMs === 0) return { events, unverifiedSeconds: 0 };
  return { events: out, unverifiedSeconds: Math.floor(unverifiedMs / 1000) };
}
