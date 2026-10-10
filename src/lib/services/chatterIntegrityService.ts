/**
 * Chatter Analytics' integrity layer — coverage (BuddyX online while clocked
 * in), the ranked flag list, the per-chatter report and one shift's minute
 * detail. Firestore only, like the rest of the analytics read models.
 *
 * **Display only.** Nothing here writes, and nothing feeds the salary engine
 * (rule 9f): a flag is a lead for an admin to look at, never a deduction.
 * **Admin only**, except an agent's own `coverage` figure — the routes enforce
 * that; this module never decides who may see what.
 */
import 'server-only';
import { adminDb } from '../firebase-admin';
import { dayKeyRange, enumerateDays, toDayKey, type SalaryDayKey } from '../salary/salaryDate';
import {
  COVERAGE_FLAG_RATIO,
  COVERAGE_HIGH_RATIO,
  COVERAGE_MIN_CLOCKED_MS,
  HOUR_MS,
  LEDGER_LOOKBACK_MS,
  coverageFor,
  hourKey,
  msPerHour,
  sessionSpans,
  workingSpans,
  type CoverageDay,
  type CoverageFigures,
} from '../buddyx/coverage';
import { INTERVAL_MODIFIER_ONLY } from '../inputQuality';
import { serialiseShift } from '../utils/shiftSerialise';
import { expandShiftsForWindow } from '../utils/recurrence';
import { getActiveSessionsForUsers, getLedgerEntriesForUsers, getShiftsByRange } from './shiftService';
import { getIntegrityCaptures, type IntegrityCaptureDocument, type IntegrityDayDocument } from './integrityService';
import { getScreenshotUrl } from './screenshotService';
import type { IntegrityFlag, IntegritySummary, ReportShift, ShiftDetail } from '../buddyx/analyticsTypes';
import type { ActiveSessionDocument, BuddyxTeamDayDocument, BuddyxTeamHoursDocument, TimeEntryLedgerDocument } from '@/types/firestore';

// ─── Flag thresholds ─────────────────────────────────────────────────
// Leads, not verdicts. Each is a total over the period, so a single odd
// minute never surfaces; the report shows exactly when it happened.

/** Machine-regular rhythm or modifier-only input this many minutes in a period flags. */
const INPUT_FLAG_MINUTES = 30;
const INPUT_HIGH_MINUTES = 120;
/** Unchanged-screen minutes this many in a period flags. */
const STATIC_FLAG_MINUTES = 60;
const STATIC_HIGH_MINUTES = 180;
/** A day with less clocked working time than this is not judged on its own coverage. */
const DAY_MIN_CLOCKED_MS = 30 * 60_000;

// ─── Hourly BuddyX data ──────────────────────────────────────────────

export async function readTeamHours(days: SalaryDayKey[]): Promise<Map<string, BuddyxTeamHoursDocument>> {
  const out = new Map<string, BuddyxTeamHoursDocument>();
  if (days.length === 0) return out;
  const snaps = await adminDb.getAll(...days.map(d => adminDb.collection('buddyx-team-hours').doc(d)));
  for (const snap of snaps) if (snap.exists) out.set(snap.id, snap.data() as BuddyxTeamHoursDocument);
  return out;
}

function hourPulled(hoursDocs: Map<string, BuddyxTeamHoursDocument>, hourStartMs: number): boolean {
  const { day, index } = hourKey(hourStartMs);
  return hoursDocs.get(day)?.hours?.[index] !== undefined;
}

/** True when every hour of the day that has ended (by `now`) has been pulled. */
function dayHasAllHours(hoursDocs: Map<string, BuddyxTeamHoursDocument>, day: SalaryDayKey, now: number): boolean {
  if (!hoursDocs.has(day)) return false;
  const [start, end] = dayKeyRange(day);
  const last = Math.min(end, Math.floor(now / HOUR_MS) * HOUR_MS);
  for (let h = start; h < last; h += HOUR_MS) if (!hourPulled(hoursDocs, h)) return false;
  return true;
}

type HourIndex = { online: Map<string, Map<number, number>>; messages: Map<string, Map<number, number>> };
const hourIndexes = new WeakMap<Map<string, BuddyxTeamHoursDocument>, HourIndex>();

/**
 * Online ms and messages per hour, per uid, across every chatter id mapped to
 * that uid — built in **one pass** over the docs and memoised on the (cached)
 * docs map, so a page of 40 agents does not rescan every doc 40 times.
 */
function hourIndex(hoursDocs: Map<string, BuddyxTeamHoursDocument>): HourIndex {
  const hit = hourIndexes.get(hoursDocs);
  if (hit) return hit;
  const index: HourIndex = { online: new Map(), messages: new Map() };
  for (const [day, doc] of hoursDocs) {
    const [start] = dayKeyRange(day);
    for (const field of ['online', 'messages'] as const) {
      for (const [chatterId, byHour] of Object.entries(doc[field] ?? {})) {
        const uid = doc.uids?.[chatterId];
        if (!uid) continue;
        const perUid = index[field].get(uid) ?? new Map<number, number>();
        for (const [i, value] of Object.entries(byHour)) {
          const h = start + Number(i) * HOUR_MS;
          perUid.set(h, (perUid.get(h) ?? 0) + (Number(value) || 0));
        }
        index[field].set(uid, perUid);
      }
    }
  }
  hourIndexes.set(hoursDocs, index);
  return index;
}

const EMPTY = new Map<number, number>();

/** The first day in the list that has complete hourly data, or null. */
export function firstHourlyDay(days: SalaryDayKey[], hoursDocs: Map<string, BuddyxTeamHoursDocument>, now: number): string | null {
  return days.find(d => dayHasAllHours(hoursDocs, d, now)) ?? null;
}

/** `[start, min(now, end)]` of a run of days. */
function windowOf(days: SalaryDayKey[], now: number): [number, number] {
  if (days.length === 0) return [now, now];
  return [dayKeyRange(days[0])[0], Math.min(now, dayKeyRange(days[days.length - 1])[1])];
}

/**
 * One agent's coverage over `days`. `dayDocs` supplies the day-total fallback
 * for days without complete hourly data.
 */
export function agentCoverage(params: {
  uid: string;
  days: SalaryDayKey[];
  now: number;
  hoursDocs: Map<string, BuddyxTeamHoursDocument>;
  dayDocs: Map<string, BuddyxTeamDayDocument>;
  entries: TimeEntryLedgerDocument[];
  active: ActiveSessionDocument | undefined;
}): CoverageFigures & { byDay: CoverageDay[] } {
  const { uid, days, now, hoursDocs, dayDocs } = params;
  const [windowStart, windowEnd] = windowOf(days, now);
  const spans = workingSpans(params.entries, params.active, windowStart, windowEnd, now);
  return coverageFor({
    days: days.map(day => {
      const [start, end] = dayKeyRange(day);
      return {
        day,
        start,
        end: Math.min(end, now),
        hasHours: dayHasAllHours(hoursDocs, day, now),
        dayOnlineMs: (dayDocs.get(day)?.breakdown ?? []).filter(r => r.uid === uid).reduce((s, r) => s + (r.onlineMs ?? 0), 0),
      };
    }),
    workingByHour: msPerHour(spans),
    onlineByHour: hourIndex(hoursDocs).online.get(uid) ?? EMPTY,
  });
}

export function summariseIntegrity(docs: IntegrityDayDocument[] | undefined): IntegritySummary | null {
  if (!docs || docs.length === 0) return null;
  const latest = docs.reduce((a, b) => (b.day > a.day ? b : a));
  const sum = (k: keyof IntegrityDayDocument) => docs.reduce((s, d) => s + (Number(d[k]) || 0), 0);
  return {
    monitoredMinutes: sum('monitoredMinutes'),
    keys: sum('keys'),
    regularMinutes: sum('regularMinutes'),
    modifierOnlyMinutes: sum('modifierOnlyMinutes'),
    staticMinutes: sum('staticMinutes'),
    captures: sum('captures'),
    comparedCaptures: sum('comparedCaptures'),
    unchangedCaptures: sum('unchangedCaptures'),
    inputSource: latest.inputSource ?? null,
    permission: latest.permission ?? null,
  };
}

// ─── Flags ───────────────────────────────────────────────────────────

const SEVERITY_RANK = { high: 0, medium: 1 } as const;

/** Rank: severity, then size (minutes, or how far below the coverage line). */
function flagMagnitude(f: IntegrityFlag): number {
  if (f.kind === 'low-coverage') return 1 - (f.ratio ?? 1);
  if (f.kind === 'never-online') return 1;
  return (f.minutes ?? 0) / 600;
}

export function sortFlags(flags: IntegrityFlag[]): IntegrityFlag[] {
  return flags.sort(
    (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || flagMagnitude(b) - flagMagnitude(a) || a.name.localeCompare(b.name),
  );
}

/** The flags one agent earns over a period. */
export function flagsForAgent(params: {
  uid: string;
  name: string;
  coverage: (CoverageFigures & { byDay: CoverageDay[] }) | null;
  rosteredShifts: number;
  integrityDays: IntegrityDayDocument[] | undefined;
}): IntegrityFlag[] {
  const { uid, name, coverage } = params;
  const out: IntegrityFlag[] = [];
  const base = { uid, name, minutes: null, ratio: null, shifts: null };

  if (params.rosteredShifts > 0 && coverage && coverage.onlineMs === 0) {
    out.push({ ...base, kind: 'never-online', severity: 'high', shifts: params.rosteredShifts, days: [] });
  } else if (coverage && coverage.ratio !== null && coverage.clockedMs >= COVERAGE_MIN_CLOCKED_MS && coverage.ratio < COVERAGE_FLAG_RATIO) {
    out.push({
      ...base,
      kind: 'low-coverage',
      severity: coverage.ratio < COVERAGE_HIGH_RATIO ? 'high' : 'medium',
      ratio: coverage.ratio,
      shifts: params.rosteredShifts || null,
      days: coverage.byDay
        .filter(d => d.clockedMs >= DAY_MIN_CLOCKED_MS && d.onlineWhileClockedMs / d.clockedMs < COVERAGE_FLAG_RATIO)
        .map(d => d.day),
    });
  }

  const days = params.integrityDays ?? [];
  const summary = summariseIntegrity(days);
  if (!summary) return out;
  const daysWith = (k: keyof IntegrityDayDocument) => days.filter(d => (Number(d[k]) || 0) > 0).map(d => d.day).sort();
  const minuteFlag = (kind: IntegrityFlag['kind'], minutes: number, key: keyof IntegrityDayDocument, flagAt: number, highAt: number) => {
    if (minutes >= flagAt) out.push({ ...base, kind, severity: minutes >= highAt ? 'high' : 'medium', minutes, days: daysWith(key) });
  };
  minuteFlag('regular-input', summary.regularMinutes, 'regularMinutes', INPUT_FLAG_MINUTES, INPUT_HIGH_MINUTES);
  minuteFlag('modifier-only', summary.modifierOnlyMinutes, 'modifierOnlyMinutes', INPUT_FLAG_MINUTES, INPUT_HIGH_MINUTES);
  minuteFlag('static-screen', summary.staticMinutes, 'staticMinutes', STATIC_FLAG_MINUTES, STATIC_HIGH_MINUTES);

  // Monitoring on, but macOS Input Monitoring refused: the rhythm and filler-key
  // signals are blind for this agent, which is itself worth knowing.
  if (summary.inputSource === 'counters' && summary.permission === 'denied') {
    const latest = days.reduce((a, b) => (b.day > a.day ? b : a));
    out.push({ ...base, kind: 'input-permission', severity: 'medium', days: [latest.day] });
  }
  return out;
}

// ─── Report ──────────────────────────────────────────────────────────

/** Shift occurrences for one agent in a window. */
async function occurrencesFor(uid: string, start: number, end: number) {
  const docs = await getShiftsByRange(start, end, uid);
  const raw = docs.map(s => ({ ...serialiseShift(s), timeWorkedSeconds: null, attendanceStatus: null }));
  return expandShiftsForWindow(raw, start, end)
    .filter(o => o.userId === uid && o.paysWage !== false)
    .sort((a, b) => a.occurrenceStart - b.occurrenceStart);
}

/**
 * The report's shift table: every scheduled shift in the window, then any
 * session that overlapped no shift at all (worked off-roster). Coverage per
 * shift is the same per-hour min() as the page, restricted to the shift.
 */
export async function reportShifts(params: {
  uid: string;
  start: number;
  end: number;
  now: number;
  entries: TimeEntryLedgerDocument[];
  active: ActiveSessionDocument | undefined;
  hoursDocs: Map<string, BuddyxTeamHoursDocument>;
  captures: IntegrityCaptureDocument[];
}): Promise<ReportShift[]> {
  const { uid, start, end, now, entries, active, hoursDocs, captures } = params;
  const occurrences = await occurrencesFor(uid, start, end);
  const index = hourIndex(hoursDocs);
  const online = index.online.get(uid) ?? EMPTY;
  const messages = index.messages.get(uid) ?? EMPTY;

  const row = (s: number, e: number, scheduled: boolean, isOvertime: boolean, accounts: number): ReportShift => {
    const spans = workingSpans(entries, active, s, e, now);
    const working = msPerHour(spans);
    const clockedMs = spans.reduce((t, [a, b]) => t + (b - a), 0);
    let hasHours = true;
    let overlap = 0;
    let messageCount = 0;
    for (let h = Math.floor(s / HOUR_MS) * HOUR_MS; h < Math.min(e, now); h += HOUR_MS) {
      if (!hourPulled(hoursDocs, h)) hasHours = false;
      // The part of the hour inside the shift, so a shift starting at :30 is
      // not credited a whole hour of someone else's online time.
      const inShift = Math.min(e, h + HOUR_MS) - Math.max(s, h);
      overlap += Math.min(inShift, online.get(h) ?? 0, working.get(h) ?? 0);
      messageCount += messages.get(h) ?? 0;
    }
    const inShift = captures.filter(c => c.at.toMillis() > s && c.at.toMillis() <= e + 15 * 60_000);
    return {
      startMs: s,
      endMs: e,
      scheduled,
      isOvertime,
      accounts,
      clockedMs,
      onlineWhileClockedMs: hasHours ? overlap : null,
      ratio: hasHours && clockedMs > 0 ? Math.round((overlap / clockedMs) * 1000) / 1000 : null,
      messages: hasHours ? messageCount : null,
      regularMinutes: inShift.reduce((t, c) => t + (c.input?.regularMinutes ?? 0), 0),
      modifierOnlyMinutes: inShift.reduce((t, c) => t + (c.input?.modifierOnlyMinutes ?? 0), 0),
      staticMinutes: inShift.reduce((t, c) => t + (c.unchanged ? Math.round((c.windowEndMs - c.windowStartMs) / 60_000) : 0), 0),
      monitored: inShift.some(c => c.input !== null),
    };
  };

  const rows = occurrences.map(o =>
    row(o.occurrenceStart, o.occurrenceEnd, true, o.isOvertime === true, (o.creatorIds ?? []).length),
  );
  const sessions: Array<[number, number]> = entries.map(e => [e.startTime.toMillis(), e.endTime.toMillis()]);
  if (active && !active.userClockOut) sessions.push([active.startTime.toMillis(), now]);
  for (const [s, e] of sessions) {
    if (e <= start || s >= end) continue;
    if (occurrences.some(o => s < o.occurrenceEnd && e > o.occurrenceStart)) continue;
    rows.push(row(Math.max(s, start), Math.min(e, end), false, false, 0));
  }
  return rows.sort((a, b) => b.startMs - a.startMs);
}

export async function reportReads(uid: string, days: SalaryDayKey[], now: number) {
  const [start, end] = windowOf(days, now);
  const [ledger, active, captures] = await Promise.all([
    getLedgerEntriesForUsers([uid], start - LEDGER_LOOKBACK_MS, end),
    getActiveSessionsForUsers([uid]),
    getIntegrityCaptures(uid, start, end + 30 * 60_000),
  ]);
  return { start, end, entries: ledger.get(uid) ?? [], active: active.get(uid), captures };
}

// ─── One shift at minute grain ───────────────────────────────────────

const MAX_DETAIL_MS = 18 * HOUR_MS;

/** Signed thumbnail URLs per capture group, for this user's screenshots only. */
async function thumbnailsFor(uid: string, captureGroups: string[]): Promise<Map<string, string[]>> {
  const chunks: string[][] = [];
  for (let i = 0; i < captureGroups.length; i += 30) chunks.push(captureGroups.slice(i, i + 30));
  const snaps = await Promise.all(
    chunks.map(chunk => adminDb.collection('screenshots').where('userId', '==', uid).where('captureGroup', 'in', chunk).get()),
  );
  const docs = snaps
    .flatMap(s => s.docs.map(d => d.data() as { captureGroup: string; screenIndex: number; thumbnailPath?: string | null; storagePath: string }))
    .sort((a, b) => a.screenIndex - b.screenIndex);
  const urls = await Promise.all(docs.map(d => getScreenshotUrl(d.thumbnailPath || d.storagePath)));
  const out = new Map<string, string[]>();
  docs.forEach((d, i) => out.set(d.captureGroup, [...(out.get(d.captureGroup) ?? []), urls[i]]));
  return out;
}

export async function getShiftDetail(params: {
  uid: string;
  startMs: number;
  endMs: number;
  scheduled: boolean;
  canViewScreenshots: boolean;
  now?: number;
}): Promise<ShiftDetail> {
  const now = params.now ?? Date.now();
  const [ledger, active] = await Promise.all([
    getLedgerEntriesForUsers([params.uid], params.startMs - LEDGER_LOOKBACK_MS, params.endMs),
    getActiveSessionsForUsers([params.uid]),
  ]);
  const entries = (ledger.get(params.uid) ?? []).filter(
    e => e.endTime.toMillis() > params.startMs && e.startTime.toMillis() < params.endMs,
  );
  const activeSession = active.get(params.uid);

  // Widen to the sessions that touch the shift, so an early clock-in or a late
  // finish is drawn rather than clipped away.
  let fromMs = params.startMs;
  let toMs = Math.min(params.endMs, now);
  for (const e of entries) {
    fromMs = Math.min(fromMs, e.startTime.toMillis());
    toMs = Math.max(toMs, Math.min(e.endTime.toMillis(), now));
  }
  if (toMs - fromMs > MAX_DETAIL_MS) fromMs = toMs - MAX_DETAIL_MS;
  fromMs = Math.floor(fromMs / 60_000) * 60_000;

  const [hoursDocs, captures] = await Promise.all([
    readTeamHours(enumerateDays(toDayKey(fromMs), toDayKey(toMs))),
    getIntegrityCaptures(params.uid, fromMs, toMs + 30 * 60_000),
  ]);
  const thumbs = params.canViewScreenshots && captures.length > 0
    ? await thumbnailsFor(params.uid, captures.map(c => c.captureGroup))
    : new Map<string, string[]>();

  const index = hourIndex(hoursDocs);
  const online = index.online.get(params.uid) ?? EMPTY;
  const messages = index.messages.get(params.uid) ?? EMPTY;
  const hours: ShiftDetail['hours'] = [];
  for (let h = Math.floor(fromMs / HOUR_MS) * HOUR_MS; h < toMs; h += HOUR_MS) {
    const has = hourPulled(hoursDocs, h);
    hours.push({ startMs: h, onlineMs: has ? Math.min(HOUR_MS, online.get(h) ?? 0) : null, messages: has ? messages.get(h) ?? 0 : null });
  }

  const minuteCount = Math.ceil((toMs - fromMs) / 60_000);
  const keysPerMinute = new Array<number>(minuteCount).fill(-1);
  const intervals: ShiftDetail['intervals'] = [];
  let inputSource: ShiftDetail['inputSource'] = null;
  let permission: ShiftDetail['permission'] = null;
  for (const c of captures) {
    if (c.input) {
      const input = c.input;
      inputSource = input.source;
      permission = input.permission;
      input.perMinute.forEach((n, i) => {
        const slot = Math.floor((input.fromMs + i * 60_000 - fromMs) / 60_000);
        if (slot >= 0 && slot < minuteCount && n >= 0) keysPerMinute[slot] = n;
      });
      for (let i = 0; i + 2 < input.intervals.length; i += 3) {
        const [a, b, kind] = input.intervals.slice(i, i + 3);
        intervals.push({ startMs: a, endMs: b, kind: kind === INTERVAL_MODIFIER_ONLY ? 'modifier-only' : 'regular' });
      }
    }
    if (c.unchanged) intervals.push({ startMs: c.windowStartMs, endMs: c.windowEndMs, kind: 'static' });
  }

  return {
    fromMs,
    toMs,
    scheduled: params.scheduled ? { startMs: params.startMs, endMs: params.endMs } : null,
    segments: sessionSpans(entries, activeSession, fromMs, toMs, now),
    hours,
    keysPerMinute,
    intervals,
    captures: captures.map(c => ({
      atMs: c.at.toMillis(),
      activityPercent: c.activityPercent,
      unchanged: c.unchanged,
      // Thumbnails only for a viewer who may already see this person's
      // screenshots — the report must not widen that access (rule 10).
      thumbnails: params.canViewScreenshots ? thumbs.get(c.captureGroup) ?? [] : null,
    })),
    inputSource,
    permission,
  };
}
