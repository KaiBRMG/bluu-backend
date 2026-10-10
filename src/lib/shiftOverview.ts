/**
 * Shift Management → Overview: the wire shape of `/api/admin/shift-management/overview`
 * and the pure derivation of the "Needs attention" queue from it.
 *
 * The queue is assembled from two sources on purpose:
 *   - the route's SETTLED facts (shift occurrences + attendance, closed sessions,
 *     yesterday's ledger) — read once per page view, batched server-side;
 *   - the LIVE `active_sessions` snapshot the page already subscribes to.
 * Anything that changes by the minute (idle, break length, a silent app, "not in
 * yet") is derived here from the live snapshot plus a minute clock, so the page
 * never polls the route to stay current (rule 9i).
 *
 * Everything here is display only. Nothing in the queue changes the time ledger,
 * pay or idle state — it points an admin at a record; the record's own surface
 * is where anything is changed.
 */

import { LATE_AFTER_MS } from '@/lib/utils/shiftAttendance';
import { safeTimezone, toLocalDateStr } from '@/lib/utils/timezone';

// ─── Wire shape ──────────────────────────────────────────────────────

export interface OverviewPerson {
  uid: string;
  displayName: string;
  photoURL: string | null;
}

export interface OverviewShift {
  /** `${shiftId}:${occurrenceStart}` — stable per occurrence. */
  key: string;
  userId: string;
  start: number;
  end: number;
  /** Null for an occurrence that has not started. */
  attendance: 'on-time' | 'late' | 'absent' | null;
  /** First clock-in credited to this occurrence, if any. */
  clockInMs: number | null;
  leave: { status: 'pending' | 'approved' | 'denied'; type: 'paid' | 'unpaid' } | null;
}

/** The four states a clocked-in session can be in — `SegmentState`'s vocabulary. */
export const LIVE_STATES = ['working', 'idle', 'on-break', 'paused'] as const;
export type LiveState = (typeof LIVE_STATES)[number];

/** `[startMs, endMs, state]` — state codes match `SegmentState`. */
export type OverviewSpan = [number, number, LiveState];

export interface OverviewSession {
  sessionId: string;
  userId: string;
  start: number;
  end: number;
  /** Empty = no event log ("unknown", never "worked the whole span"). */
  spans: OverviewSpan[];
}

export type SettledFlag =
  | { kind: 'missed-clock-out'; userId: string; sessionId: string; start: number; end: number }
  | { kind: 'no-break'; userId: string; date: string; workingSeconds: number };

export interface ShiftOverviewResponse {
  generatedAt: number;
  /** The viewer's resolved zone — every "today"/"yesterday" below is in it. */
  timezone: string;
  today: string;
  yesterday: string;
  todayBounds: { start: number; end: number };
  people: OverviewPerson[];
  shifts: OverviewShift[];
  sessions: OverviewSession[];
  flags: SettledFlag[];
}

// ─── Live session (a structural subset of useActiveUsers' rows) ──────

export interface LiveSession {
  userId: string;
  currentState: LiveState;
  startTime: Date;
  /**
   * A client→server check-in time — stamped on every state change, and by the
   * 15-min heartbeat while working. NOT a last-input time (time-tracking.md
   * gotchas): for a non-working state it is when that state began, nothing more.
   */
  lastUpdated: Date;
}

// ─── Queue ───────────────────────────────────────────────────────────

/** Idle this long, uninterrupted, is worth a look (the idle state itself is not). */
const IDLE_ALERT_MS = 20 * 60 * 1000;
/** Matches one shift's break allowance (`computeBreakAllowance`: 45 min per 8h). */
const BREAK_ALERT_MS = 45 * 60 * 1000;
/**
 * The heartbeat runs every 15 min while working, so two missed beats plus slack
 * means the app has stopped reporting (closed, crashed, or offline).
 */
const SILENT_ALERT_MS = 35 * 60 * 1000;
/** Still clocked in this long after the last shift of the day ended. */
const OVERRUN_ALERT_MS = 30 * 60 * 1000;

export type AttentionKind =
  | 'not-in'
  | 'idle-long'
  | 'long-break'
  | 'silent'
  | 'overrun'
  | 'missed-shift'
  | 'late'
  | 'missed-clock-out'
  | 'no-break';

/** `now` waits on someone this minute; `earlier` is a record to review. */
export type AttentionTier = 'now' | 'earlier';

/** Hue family per kind — red is a failure, orange waits on a person, yellow is a review. */
export type AttentionTone = 'red' | 'orange' | 'yellow';

export type AttentionTarget = 'timeline' | 'screenshots' | 'shifts';

export interface AttentionItem {
  /** Stable id — also the dismissal key. */
  id: string;
  kind: AttentionKind;
  tier: AttentionTier;
  tone: AttentionTone;
  userId: string;
  /** Plain-language reason, without the person's name. */
  title: string;
  /** One Meta line: when / how long / what the record says. */
  detail: string;
  /** Sort key within a tier — most recent / longest-running first. */
  at: number;
  /** Where "Open" lands in the person sheet. */
  target: AttentionTarget;
  /** Date the target section should open on (YYYY-MM-DD in the viewer's zone). */
  date: string;
}

// One formatter per zone: `deriveAttention` reruns every minute and on every
// live snapshot, and the timeline formats per tick and per row.
const clockFormatters = new Map<string, Intl.DateTimeFormat>();

/** "14:05" in `tz` (24h). Any zone is safe — empty or invalid falls back to UTC (rule 9g). */
export function formatClock(ms: number, tz: string): string {
  const zone = safeTimezone(tz);
  let fmt = clockFormatters.get(zone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit', hour12: false });
    clockFormatters.set(zone, fmt);
  }
  return fmt.format(new Date(ms));
}

export function formatSpan(ms: number): string {
  const totalMin = Math.max(0, Math.round(ms / 60_000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${String(m).padStart(2, '0')}m`;
}

/**
 * The one definition of where a started shift stands, shared by the queue and
 * the today timeline so the two can never disagree. A live session clears
 * "not in"; approved leave clears both; nothing is flagged before the 30-min
 * late threshold.
 */
export type ShiftStanding = 'upcoming' | 'on-leave' | 'missed' | 'not-in' | 'late' | 'ok';

export function shiftStanding(sh: OverviewShift, hasLive: boolean, now: number): ShiftStanding {
  if (sh.start > now) return 'upcoming';
  if (sh.leave?.status === 'approved') return 'on-leave';
  if (sh.attendance === 'late') return 'late';
  if (sh.attendance !== 'absent') return 'ok';
  if (sh.end <= now) return 'missed';
  return !hasLive && now - sh.start >= LATE_AFTER_MS ? 'not-in' : 'ok';
}

/**
 * Build the queue. Pure: `now` is passed in so a minute clock drives re-evaluation
 * and the same inputs always produce the same list.
 */
export function deriveAttention(
  data: ShiftOverviewResponse,
  live: LiveSession[],
  now: number,
): AttentionItem[] {
  const tz = data.timezone;
  const items: AttentionItem[] = [];
  const liveByUser = new Map(live.map(s => [s.userId, s]));
  const known = new Set(data.people.map(p => p.uid));

  // ── Live ────────────────────────────────────────────────────────
  for (const s of live) {
    if (!known.has(s.userId)) continue;
    const sinceMs = s.lastUpdated.getTime();
    const forMs = now - sinceMs;
    if (s.currentState === 'idle' && forMs >= IDLE_ALERT_MS) {
      items.push({
        id: `idle-long:${s.userId}:${sinceMs}`, kind: 'idle-long', tier: 'now', tone: 'orange',
        userId: s.userId, title: `Idle for ${formatSpan(forMs)}`,
        detail: `Went idle at ${formatClock(sinceMs, tz)} · still clocked in`,
        at: sinceMs, target: 'screenshots', date: data.today,
      });
    } else if (s.currentState === 'on-break' && forMs >= BREAK_ALERT_MS) {
      items.push({
        id: `long-break:${s.userId}:${sinceMs}`, kind: 'long-break', tier: 'now', tone: 'orange',
        userId: s.userId, title: `On break for ${formatSpan(forMs)}`,
        detail: `Since ${formatClock(sinceMs, tz)} · allowance is 45m per 8h shift`,
        at: sinceMs, target: 'timeline', date: data.today,
      });
    } else if (s.currentState === 'working' && forMs >= SILENT_ALERT_MS) {
      items.push({
        id: `silent:${s.userId}:${sinceMs}`, kind: 'silent', tier: 'now', tone: 'orange',
        userId: s.userId, title: 'App has stopped reporting',
        detail: `Last check-in ${formatClock(sinceMs, tz)} · the app may be closed or offline`,
        at: sinceMs, target: 'timeline', date: data.today,
      });
    }
  }

  // ── Shifts ──────────────────────────────────────────────────────
  // Overrun: clocked in, no shift running now, and the latest of today's
  // shifts ended a while ago. Working without a shift is never flagged —
  // many people track time without a schedule.
  const shiftsByUser = new Map<string, OverviewShift[]>();
  for (const sh of data.shifts) {
    const list = shiftsByUser.get(sh.userId) ?? [];
    list.push(sh);
    shiftsByUser.set(sh.userId, list);
  }
  for (const [uid, list] of shiftsByUser) {
    const s = liveByUser.get(uid);
    if (!s) continue;
    if (list.some(sh => sh.start <= now && sh.end > now)) continue;
    const endedToday = list
      .filter(sh => sh.end <= now && sh.end >= data.todayBounds.start)
      .sort((a, b) => b.end - a.end)[0];
    if (endedToday && now - endedToday.end >= OVERRUN_ALERT_MS && s.startTime.getTime() < endedToday.end) {
      items.push({
        id: `overrun:${uid}:${endedToday.key}`, kind: 'overrun', tier: 'now', tone: 'yellow',
        userId: uid, title: `Still clocked in ${formatSpan(now - endedToday.end)} after shift end`,
        detail: `Shift ended ${formatClock(endedToday.end, tz)} · clocked in since ${formatClock(s.startTime.getTime(), tz)}`,
        at: endedToday.end, target: 'timeline', date: data.today,
      });
    }
  }

  for (const sh of data.shifts) {
    if (!known.has(sh.userId)) continue;
    const standing = shiftStanding(sh, liveByUser.has(sh.userId), now);
    if (standing === 'upcoming' || standing === 'on-leave' || standing === 'ok') continue;
    const window = `${formatClock(sh.start, tz)}–${formatClock(sh.end, tz)}`;
    const day = toLocalDateStr(sh.start, tz);
    const dayWord = day === data.today ? 'Today' : day === data.yesterday ? 'Yesterday' : day;
    const leaveNote = sh.leave?.status === 'pending' ? ' · leave request pending' : '';

    if (standing === 'not-in') {
      items.push({
        id: `not-in:${sh.key}`, kind: 'not-in', tier: 'now', tone: 'red',
        userId: sh.userId, title: 'Not clocked in',
        detail: `Shift started ${formatSpan(now - sh.start)} ago · ${window}${leaveNote}`,
        at: sh.start, target: 'shifts', date: day,
      });
    } else if (standing === 'missed') {
      items.push({
        id: `missed-shift:${sh.key}`, kind: 'missed-shift', tier: 'earlier', tone: 'red',
        userId: sh.userId, title: 'Missed a shift',
        detail: `${dayWord} ${window} · never clocked in${leaveNote}`,
        at: sh.end, target: 'shifts', date: day,
      });
    } else if (sh.clockInMs) {
      items.push({
        id: `late:${sh.key}`, kind: 'late', tier: 'earlier', tone: 'yellow',
        userId: sh.userId, title: `Late by ${formatSpan(sh.clockInMs - sh.start)}`,
        detail: `${dayWord} · shift ${formatClock(sh.start, tz)}, clocked in ${formatClock(sh.clockInMs, tz)}`,
        at: sh.clockInMs, target: 'timeline', date: day,
      });
    }
  }

  // ── Settled ─────────────────────────────────────────────────────
  for (const f of data.flags) {
    if (!known.has(f.userId)) continue;
    if (f.kind === 'missed-clock-out') {
      const day = toLocalDateStr(f.start, tz);
      items.push({
        id: `missed-clock-out:${f.sessionId}`, kind: 'missed-clock-out', tier: 'earlier', tone: 'orange',
        userId: f.userId, title: "Didn't clock out",
        detail: `Session from ${formatClock(f.start, tz)} was closed by the system at ${formatClock(f.end, tz)} · check the hours`,
        at: f.end, target: 'timeline', date: day,
      });
    } else {
      items.push({
        id: `no-break:${f.userId}:${f.date}`, kind: 'no-break', tier: 'earlier', tone: 'yellow',
        userId: f.userId, title: 'Worked without a break',
        detail: `Yesterday · ${formatSpan(f.workingSeconds * 1000)} worked, no break taken`,
        at: data.todayBounds.start - 1, target: 'timeline', date: f.date,
      });
    }
  }

  const tierRank: Record<AttentionTier, number> = { now: 0, earlier: 1 };
  const toneRank: Record<AttentionTone, number> = { red: 0, orange: 1, yellow: 2 };
  return items.sort((a, b) =>
    tierRank[a.tier] - tierRank[b.tier] ||
    toneRank[a.tone] - toneRank[b.tone] ||
    b.at - a.at,
  );
}
