import {
  computeAttendanceFromBounds,
  computeWorkedInWindowFromSegments,
  type AttendanceStatus,
} from '@/lib/utils/shiftAttendance';
import { decodeSegments, decodeSessionBounds } from '@/types/firestore';
import type {
  AnalyticsDailyDocument,
  CompactSegment,
  SessionBound,
} from '@/types/firestore';

/**
 * Pure aggregation over analytics_daily rollups. No Firestore access — the
 * route fetches, this folds.
 *
 * The cardinal rule here: **means never sum**. Every average is computed as a
 * ratio of two summed quantities (Σsum / Σcount), never as an average of
 * per-day averages, which would weight a 20-minute day the same as an 8-hour
 * one. Distributions travel as histograms, which do sum.
 */

const FOCUS_BLOCK_MIN_SECONDS = 1500;

export interface ShiftOccurrence {
  userId: string;
  occurrenceStart: number;
  occurrenceEnd: number;
  /**
   * The occurrence's local date (YYYY-MM-DD) in the SHIFT OWNER's timezone.
   * Resolved by the caller, which has the user doc — deriving it here from UTC
   * would mis-bucket every shift for anyone west of Greenwich.
   */
  localDate: string;
}

export interface DailyPoint {
  date: string;
  workingSeconds: number;
  idleSeconds: number;
  breakSeconds: number;
  pauseSeconds: number;
  unknownSeconds: number;
  sessionCount: number;
  userCount: number;
  activityMean: number | null;
  provisional: boolean;
}

export interface UserSummary {
  userId: string;
  workingSeconds: number;
  idleSeconds: number;
  breakSeconds: number;
  activityMean: number | null;
  focusRatio: number | null;
  fragmentationRatio: number | null;
  daysWorked: number;
  noBreakDays: number;
  longestFocusBlockSeconds: number;
  maxConsecutiveDays: number;
  punctuality: number | null;
  lateCount: number;
  absentCount: number;
}

export interface AnalyticsTotals {
  workingSeconds: number;
  idleSeconds: number;
  breakSeconds: number;
  pauseSeconds: number;
  asleepSeconds: number;
  unknownSeconds: number;
  clockedSpanSeconds: number;
  sessionCount: number;
  screenshotCount: number;
  activityMean: number | null;
  activityHistogram: number[];
  daysWorked: number;
  activeUserCount: number;
  avgSessionSeconds: number | null;
  avgDayWorkingSeconds: number | null;
}

export interface AdherenceSummary {
  onTime: number;
  late: number;
  absent: number;
  punctuality: number | null;
  scheduledSeconds: number;
  workedInShiftSeconds: number;
  unrosteredOvertimeSeconds: number;
  coverageRatio: number | null;
  byDate: Array<{ date: string; onTime: number; late: number; absent: number }>;
}

export interface FocusSummary {
  focusBlockCount: number;
  focusSecondsInBlocks: number;
  longestFocusBlockSeconds: number;
  interruptionCount: number;
  fragmentationRatio: number | null;
  focusRatio: number | null;
  byDate: Array<{ date: string; focusBlockCount: number; focusSecondsInBlocks: number; fragmentationRatio: number | null }>;
}

export interface WellbeingSummary {
  breakAllowanceSeconds: number;
  breakUtilisation: number | null;
  noBreakDays: number;
  maxConsecutiveDays: number;
  usersOverAllowance: number;
  byDate: Array<{ date: string; breakSeconds: number; breakAllowanceSeconds: number; noBreakDay: boolean }>;
}

export interface AnalyticsResult {
  series: DailyPoint[];
  totals: AnalyticsTotals;
  byUser: UserSummary[];
  heatmap: number[][];
  adherence: AdherenceSummary;
  focus: FocusSummary;
  wellbeing: WellbeingSummary;
  meta: {
    provisionalDays: number;
    daysWithManualEntry: number;
    rollupCount: number;
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────

const ratio = (num: number, den: number): number | null => (den > 0 ? num / den : null);

/** Day-of-week (0=Sun) of a YYYY-MM-DD string, read as a wall-clock date. */
function weekdayOf(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Merge overlapping intervals so overlapping shifts can't double-count time. */
function mergeIntervals(intervals: Array<[number, number]>): Array<[number, number]> {
  if (intervals.length === 0) return [];
  const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
  const out: Array<[number, number]> = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const last = out[out.length - 1];
    const cur = sorted[i];
    if (cur[0] <= last[1]) last[1] = Math.max(last[1], cur[1]);
    else out.push([...cur] as [number, number]);
  }
  return out;
}

/**
 * Longest run of consecutive calendar dates in the set.
 *
 * `seedDates` are dates before the range that were also worked — without them a
 * streak that began before `start` would be truncated at the range boundary and
 * under-reported.
 */
function longestStreak(dates: Set<string>, seedDates: Set<string>): number {
  const all = new Set([...dates, ...seedDates]);
  if (all.size === 0) return 0;

  const toDay = (s: string) => {
    const [y, m, d] = s.split('-').map(Number);
    return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
  };
  const days = [...all].map(toDay).sort((a, b) => a - b);
  const inRange = new Set([...dates].map(toDay));

  let best = 0, run = 0;
  for (let i = 0; i < days.length; i++) {
    run = i > 0 && days[i] === days[i - 1] + 1 ? run + 1 : 1;
    // Only report streaks that actually touch the requested range.
    if (inRange.has(days[i])) best = Math.max(best, run);
  }
  return best;
}

// ─── Main ────────────────────────────────────────────────────────────

/**
 * @param rollups   Rollups inside the requested range.
 * @param seedRollups Rollups from the days immediately BEFORE the range, used
 *                  only to seed consecutive-day streaks.
 * @param shifts    Expanded shift occurrences overlapping the range.
 */
export function aggregateAnalytics(
  rollups: AnalyticsDailyDocument[],
  seedRollups: AnalyticsDailyDocument[],
  shifts: ShiftOccurrence[],
): AnalyticsResult {
  // ── Per-user accumulation ─────────────────────────────────────────
  interface UserAcc {
    working: number; idle: number; break_: number; pause: number;
    activitySum: number; activityCount: number;
    focusBlocks: number; focusSeconds: number; longestFocus: number;
    interruptions: number;
    noBreakDays: number;
    workedDates: Set<string>;
    bounds: SessionBound[];
    segments: CompactSegment[];
    onTime: number; late: number; absent: number;
  }
  const users = new Map<string, UserAcc>();
  const userAcc = (uid: string): UserAcc => {
    let a = users.get(uid);
    if (!a) {
      a = {
        working: 0, idle: 0, break_: 0, pause: 0,
        activitySum: 0, activityCount: 0,
        focusBlocks: 0, focusSeconds: 0, longestFocus: 0, interruptions: 0,
        noBreakDays: 0, workedDates: new Set(), bounds: [], segments: [],
        onTime: 0, late: 0, absent: 0,
      };
      users.set(uid, a);
    }
    return a;
  };

  // ── Per-date accumulation ─────────────────────────────────────────
  interface DateAcc {
    working: number; idle: number; break_: number; pause: number; unknown: number;
    sessions: number; users: Set<string>;
    activitySum: number; activityCount: number;
    provisional: boolean;
    focusBlocks: number; focusSeconds: number; interruptions: number;
    breakAllowance: number; noBreakDay: boolean;
  }
  const dates = new Map<string, DateAcc>();
  const dateAcc = (d: string): DateAcc => {
    let a = dates.get(d);
    if (!a) {
      a = {
        working: 0, idle: 0, break_: 0, pause: 0, unknown: 0,
        sessions: 0, users: new Set(), activitySum: 0, activityCount: 0,
        provisional: false, focusBlocks: 0, focusSeconds: 0, interruptions: 0,
        breakAllowance: 0, noBreakDay: false,
      };
      dates.set(d, a);
    }
    return a;
  };

  const totals: AnalyticsTotals = {
    workingSeconds: 0, idleSeconds: 0, breakSeconds: 0, pauseSeconds: 0,
    asleepSeconds: 0, unknownSeconds: 0, clockedSpanSeconds: 0,
    sessionCount: 0, screenshotCount: 0,
    activityMean: null, activityHistogram: new Array(10).fill(0),
    daysWorked: 0, activeUserCount: 0,
    avgSessionSeconds: null, avgDayWorkingSeconds: null,
  };

  const heatmap: number[][] = Array.from({ length: 7 }, () => new Array(24).fill(0));
  let activitySum = 0, activityCount = 0;
  let focusBlockCount = 0, focusSecondsInBlocks = 0, longestFocusBlockSeconds = 0;
  let interruptionCount = 0;
  let breakAllowanceSeconds = 0, noBreakDays = 0;
  let provisionalDays = 0, daysWithManualEntry = 0;

  for (const r of rollups) {
    const u = userAcc(r.userId);
    const d = dateAcc(r.date);

    totals.workingSeconds     += r.workingSeconds;
    totals.idleSeconds        += r.idleSeconds;
    totals.breakSeconds       += r.breakSeconds;
    totals.pauseSeconds       += r.pauseSeconds;
    totals.asleepSeconds      += r.asleepSeconds ?? 0;
    totals.unknownSeconds     += r.unknownSeconds ?? 0;
    totals.clockedSpanSeconds += r.clockedSpanSeconds ?? 0;
    totals.sessionCount       += r.sessionCount;
    totals.screenshotCount    += r.screenshotCount ?? 0;

    activitySum   += r.activitySum ?? 0;
    activityCount += r.activityCount ?? 0;
    for (let i = 0; i < 10; i++) {
      totals.activityHistogram[i] += r.activityHistogram?.[i] ?? 0;
    }

    focusBlockCount      += r.focusBlockCount ?? 0;
    focusSecondsInBlocks += r.focusSecondsInBlocks ?? 0;
    interruptionCount    += r.interruptionCount ?? 0;
    longestFocusBlockSeconds = Math.max(longestFocusBlockSeconds, r.longestFocusBlockSeconds ?? 0);

    breakAllowanceSeconds += r.breakAllowanceSeconds ?? 0;
    if (r.noBreakDay) noBreakDays++;
    if (r.hasIncompleteLog) provisionalDays++;
    if (r.hasManualEntry) daysWithManualEntry++;

    // Weekday × local hour. `date` is already the user's LOCAL day, and
    // hourBuckets are already local hours, so no conversion is needed here.
    const wd = weekdayOf(r.date);
    const buckets = r.hourBuckets ?? [];
    for (let h = 0; h < 24; h++) heatmap[wd][h] += buckets[h] ?? 0;

    // user
    u.working += r.workingSeconds;
    u.idle    += r.idleSeconds;
    u.break_  += r.breakSeconds;
    u.pause   += r.pauseSeconds;
    u.activitySum   += r.activitySum ?? 0;
    u.activityCount += r.activityCount ?? 0;
    u.focusBlocks   += r.focusBlockCount ?? 0;
    u.focusSeconds  += r.focusSecondsInBlocks ?? 0;
    u.interruptions += r.interruptionCount ?? 0;
    u.longestFocus = Math.max(u.longestFocus, r.longestFocusBlockSeconds ?? 0);
    if (r.noBreakDay) u.noBreakDays++;
    if (r.workingSeconds > 0) u.workedDates.add(r.date);
    u.bounds.push(...decodeSessionBounds(r.sessionBounds));
    u.segments.push(...decodeSegments(r.segments));

    // date
    d.working += r.workingSeconds;
    d.idle    += r.idleSeconds;
    d.break_  += r.breakSeconds;
    d.pause   += r.pauseSeconds;
    d.unknown += r.unknownSeconds ?? 0;
    d.sessions += r.sessionCount;
    d.users.add(r.userId);
    d.activitySum   += r.activitySum ?? 0;
    d.activityCount += r.activityCount ?? 0;
    d.focusBlocks   += r.focusBlockCount ?? 0;
    d.focusSeconds  += r.focusSecondsInBlocks ?? 0;
    d.interruptions += r.interruptionCount ?? 0;
    d.breakAllowance += r.breakAllowanceSeconds ?? 0;
    if (r.hasIncompleteLog) d.provisional = true;
    if (r.noBreakDay) d.noBreakDay = true;
  }

  totals.activityMean = ratio(activitySum, activityCount);
  totals.daysWorked = [...dates.values()].filter(d => d.working > 0).length;
  totals.activeUserCount = [...users.values()].filter(u => u.working > 0).length;
  totals.avgSessionSeconds = ratio(totals.workingSeconds, totals.sessionCount);
  totals.avgDayWorkingSeconds = ratio(totals.workingSeconds, totals.daysWorked);

  // ── Schedule adherence ────────────────────────────────────────────
  const shiftsByUser = new Map<string, ShiftOccurrence[]>();
  for (const s of shifts) {
    const list = shiftsByUser.get(s.userId) ?? [];
    list.push(s);
    shiftsByUser.set(s.userId, list);
  }

  const adherenceByDate = new Map<string, { onTime: number; late: number; absent: number }>();
  let onTime = 0, late = 0, absent = 0;
  let scheduledSeconds = 0, workedInShiftSeconds = 0;

  for (const [uid, list] of shiftsByUser) {
    const u = users.get(uid);
    const bounds = u?.bounds ?? [];
    const segments = u?.segments ?? [];

    for (const s of list) {
      scheduledSeconds += Math.max(0, Math.floor((s.occurrenceEnd - s.occurrenceStart) / 1000));

      const status: AttendanceStatus = computeAttendanceFromBounds(
        s.occurrenceStart, s.occurrenceEnd, bounds,
      );
      if (status === 'on-time') onTime++;
      else if (status === 'late') late++;
      else absent++;

      if (u) {
        if (status === 'on-time') u.onTime++;
        else if (status === 'late') u.late++;
        else u.absent++;
      }

      const acc = adherenceByDate.get(s.localDate) ?? { onTime: 0, late: 0, absent: 0 };
      if (status === 'on-time') acc.onTime++;
      else if (status === 'late') acc.late++;
      else acc.absent++;
      adherenceByDate.set(s.localDate, acc);
    }

    // Worked time inside the UNION of this user's shift windows — merging first
    // so two overlapping shifts cannot count the same minute twice.
    const merged = mergeIntervals(list.map(s => [s.occurrenceStart, s.occurrenceEnd]));
    for (const [a, b] of merged) {
      workedInShiftSeconds += computeWorkedInWindowFromSegments(segments, a, b);
    }
  }

  // Worked time uses computeWorkedInWindow semantics: idle and pause excluded,
  // break included — so overtime must be measured against the same quantity.
  const workedTotal = totals.workingSeconds + totals.breakSeconds;
  const adherence: AdherenceSummary = {
    onTime, late, absent,
    punctuality: ratio(onTime, onTime + late),
    scheduledSeconds,
    workedInShiftSeconds,
    unrosteredOvertimeSeconds: Math.max(0, workedTotal - workedInShiftSeconds),
    coverageRatio: ratio(workedInShiftSeconds, scheduledSeconds),
    byDate: [...adherenceByDate.entries()]
      .map(([date, v]) => ({ date, ...v }))
      .sort((a, b) => a.date.localeCompare(b.date)),
  };

  // ── Series ────────────────────────────────────────────────────────
  const series: DailyPoint[] = [...dates.entries()]
    .map(([date, d]) => ({
      date,
      workingSeconds: d.working,
      idleSeconds: d.idle,
      breakSeconds: d.break_,
      pauseSeconds: d.pause,
      unknownSeconds: d.unknown,
      sessionCount: d.sessions,
      userCount: d.users.size,
      activityMean: ratio(d.activitySum, d.activityCount),
      provisional: d.provisional,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // ── Streak seeds ──────────────────────────────────────────────────
  const seedByUser = new Map<string, Set<string>>();
  for (const r of seedRollups) {
    if (r.workingSeconds <= 0) continue;
    const set = seedByUser.get(r.userId) ?? new Set<string>();
    set.add(r.date);
    seedByUser.set(r.userId, set);
  }

  // ── Per-user summaries ────────────────────────────────────────────
  const byUser: UserSummary[] = [...users.entries()].map(([userId, u]) => ({
    userId,
    workingSeconds: u.working,
    idleSeconds: u.idle,
    breakSeconds: u.break_,
    activityMean: ratio(u.activitySum, u.activityCount),
    focusRatio: ratio(u.focusSeconds, u.working),
    fragmentationRatio: ratio(u.interruptions, u.working / 3600),
    daysWorked: u.workedDates.size,
    noBreakDays: u.noBreakDays,
    longestFocusBlockSeconds: u.longestFocus,
    maxConsecutiveDays: longestStreak(u.workedDates, seedByUser.get(userId) ?? new Set()),
    punctuality: ratio(u.onTime, u.onTime + u.late),
    lateCount: u.late,
    absentCount: u.absent,
  })).sort((a, b) => b.workingSeconds - a.workingSeconds);

  const focus: FocusSummary = {
    focusBlockCount,
    focusSecondsInBlocks,
    longestFocusBlockSeconds,
    interruptionCount,
    // Ratio of sums, never a mean of per-day ratios.
    fragmentationRatio: ratio(interruptionCount, totals.workingSeconds / 3600),
    focusRatio: ratio(focusSecondsInBlocks, totals.workingSeconds),
    byDate: series.map(p => {
      const d = dates.get(p.date)!;
      return {
        date: p.date,
        focusBlockCount: d.focusBlocks,
        focusSecondsInBlocks: d.focusSeconds,
        fragmentationRatio: ratio(d.interruptions, d.working / 3600),
      };
    }),
  };

  const wellbeing: WellbeingSummary = {
    breakAllowanceSeconds,
    breakUtilisation: ratio(totals.breakSeconds, breakAllowanceSeconds),
    noBreakDays,
    maxConsecutiveDays: byUser.reduce((max, u) => Math.max(max, u.maxConsecutiveDays), 0),
    usersOverAllowance: 0, // break is hard-capped by the client; retained for shape stability
    byDate: series.map(p => {
      const d = dates.get(p.date)!;
      return {
        date: p.date,
        breakSeconds: d.break_,
        breakAllowanceSeconds: d.breakAllowance,
        noBreakDay: d.noBreakDay,
      };
    }),
  };

  return {
    series, totals, byUser, heatmap, adherence, focus, wellbeing,
    meta: { provisionalDays, daysWithManualEntry, rollupCount: rollups.length },
  };
}

export { FOCUS_BLOCK_MIN_SECONDS };
