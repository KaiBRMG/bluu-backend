/**
 * Day and month arithmetic in the salary timezone.
 *
 * Everything the salary subsystem buckets — a sale, a shift's hours, an
 * override, a payout month — is keyed by a **calendar day in
 * {@link SALARY_TIMEZONE}**, expressed as the string `YYYY-MM-DD`. Strings
 * rather than Dates on purpose: they sort lexically, they are a legal Firestore
 * document-id fragment, and they cannot pick up a local-timezone drift in
 * transit between the server, the client and a JSON payload.
 *
 * The conversion is plain fixed-offset arithmetic rather than `Intl`. That is
 * exact here and nowhere else: CAT is UTC+2 all year and has never observed
 * DST, so there is no gap or overlap to resolve. **Do not copy these helpers to
 * a timezone that observes DST** — they would silently mis-bucket two days a
 * year. `SALARY_TZ_OFFSET_MINUTES` is the single value that makes it true.
 */

import { SALARY_TZ_OFFSET_MINUTES } from './salaryConstants';

const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 86_400_000;
const OFFSET_MS = SALARY_TZ_OFFSET_MINUTES * MS_PER_MINUTE;

/** `YYYY-MM-DD` in the salary timezone. */
export type SalaryDayKey = string;
/** `YYYY-MM` in the salary timezone. */
export type SalaryMonthKey = string;

const DAY_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_KEY_RE = /^\d{4}-\d{2}$/;

export function isDayKey(value: unknown): value is SalaryDayKey {
  return typeof value === 'string' && DAY_KEY_RE.test(value) && !Number.isNaN(dayKeyToStartMs(value));
}

export function isMonthKey(value: unknown): value is SalaryMonthKey {
  return typeof value === 'string' && MONTH_KEY_RE.test(value);
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** The calendar day a UTC instant falls on, in the salary timezone. */
export function toDayKey(utcMs: number): SalaryDayKey {
  const shifted = new Date(utcMs + OFFSET_MS);
  return `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())}`;
}

/** The calendar month a UTC instant falls in, in the salary timezone. */
export function toMonthKey(utcMs: number): SalaryMonthKey {
  return toDayKey(utcMs).slice(0, 7);
}

/** The month a day belongs to. Pure string slice — the key format guarantees it. */
export function monthOfDay(day: SalaryDayKey): SalaryMonthKey {
  return day.slice(0, 7);
}

/** UTC instant at which this salary day begins (00:00:00.000 local). */
export function dayKeyToStartMs(day: SalaryDayKey): number {
  const year = Number(day.slice(0, 4));
  const month = Number(day.slice(5, 7));
  const date = Number(day.slice(8, 10));
  return Date.UTC(year, month - 1, date) - OFFSET_MS;
}

/** UTC instant at which this salary day ends, exclusive. */
export function dayKeyToEndMs(day: SalaryDayKey): number {
  return dayKeyToStartMs(day) + MS_PER_DAY;
}

/** `[startMs, endMs)` covering one salary day. */
export function dayKeyRange(day: SalaryDayKey): [number, number] {
  const start = dayKeyToStartMs(day);
  return [start, start + MS_PER_DAY];
}

/** `[startMs, endMs)` covering a whole salary month. */
export function monthKeyRange(month: SalaryMonthKey): [number, number] {
  const year = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  return [
    Date.UTC(year, m - 1, 1) - OFFSET_MS,
    Date.UTC(m === 12 ? year + 1 : year, m === 12 ? 0 : m, 1) - OFFSET_MS,
  ];
}

/** Number of calendar days in a salary month. */
export function daysInMonth(month: SalaryMonthKey): number {
  const year = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  return new Date(Date.UTC(m === 12 ? year + 1 : year, m === 12 ? 0 : m, 0)).getUTCDate();
}

/**
 * Every day key in a month, 1st → last, ascending.
 *
 * The salary sheet has a row per calendar day whether or not anything happened
 * on it, so this is what the month grid iterates. Days with no sale and no
 * shift still render — an empty row is information ("you did not work").
 */
export function enumerateMonthDays(month: SalaryMonthKey): SalaryDayKey[] {
  const count = daysInMonth(month);
  const out: SalaryDayKey[] = [];
  for (let d = 1; d <= count; d++) out.push(`${month}-${pad2(d)}`);
  return out;
}

/** Shift a month key by whole months. `addMonths('2026-01', -1) === '2025-12'`. */
export function addMonths(month: SalaryMonthKey, delta: number): SalaryMonthKey {
  const year = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const total = year * 12 + (m - 1) + delta;
  return `${Math.floor(total / 12)}-${pad2((total % 12) + 1)}`;
}

/** Shift a day key by whole days. */
export function addDays(day: SalaryDayKey, delta: number): SalaryDayKey {
  return toDayKey(dayKeyToStartMs(day) + delta * MS_PER_DAY);
}

/** The salary month containing `now`. */
export function currentMonthKey(now: number = Date.now()): SalaryMonthKey {
  return toMonthKey(now);
}

/** The salary day containing `now`. */
export function currentDayKey(now: number = Date.now()): SalaryDayKey {
  return toDayKey(now);
}

/** Day-of-week for a salary day, 0 = Sunday. */
export function dayOfWeek(day: SalaryDayKey): number {
  return new Date(dayKeyToStartMs(day) + OFFSET_MS).getUTCDay();
}

/**
 * `"2026-08-31 23:52:34"` from the export → a UTC instant.
 *
 * The exporter writes wall-clock time already in the salary timezone and names
 * it in the column header, so the string carries no offset of its own and must
 * not be handed to `new Date()` — that would read it as local time on whatever
 * machine happens to be running the import. Returns `null` for anything that is
 * not this exact shape, which the importer reports as an unparseable row rather
 * than silently bucketing to the epoch.
 */
export function parseExportTimestamp(raw: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(raw.trim());
  if (!m) return null;

  const [, y, mo, d, h, mi, s] = m;
  const year = Number(y);
  const month = Number(mo);
  const date = Number(d);
  const hour = Number(h);
  const minute = Number(mi);
  const second = Number(s ?? '0');

  if (month < 1 || month > 12 || date < 1 || date > 31 || hour > 23 || minute > 59 || second > 59) {
    return null;
  }

  const utc = Date.UTC(year, month - 1, date, hour, minute, second) - OFFSET_MS;
  // Reject an impossible calendar date (2026-02-31) that Date.UTC would roll over.
  if (toDayKey(utc) !== `${y}-${mo}-${d}`) return null;
  return utc;
}

// ─── Presentation ────────────────────────────────────────────────────

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** `'2026-08'` → `'August 2026'`. */
export function formatMonthLabel(month: SalaryMonthKey): string {
  return `${MONTH_NAMES[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;
}

/** `'2026-08'` → `'Aug 2026'`. */
export function formatMonthLabelShort(month: SalaryMonthKey): string {
  return `${MONTH_NAMES[Number(month.slice(5, 7)) - 1].slice(0, 3)} ${month.slice(0, 4)}`;
}

/** `'2026-08-31'` → `'31 Aug'`. Day-first because the grid is read down a column of dates. */
export function formatDayLabel(day: SalaryDayKey): string {
  return `${Number(day.slice(8, 10))} ${MONTH_NAMES[Number(day.slice(5, 7)) - 1].slice(0, 3)}`;
}

/** `'2026-08-31'` → `'Mon 31 Aug'`. */
export function formatDayLabelWithWeekday(day: SalaryDayKey): string {
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return `${names[dayOfWeek(day)]} ${formatDayLabel(day)}`;
}
