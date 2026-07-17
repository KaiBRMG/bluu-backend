/**
 * Shared palette, formatters and range presets for the Analytics tab.
 *
 * Palette provenance — every value here was checked with the dataviz
 * validator against this app's chart surface (--background, #0A0A0A), not
 * chosen by eye:
 *
 *  - CATEGORICAL (work states): the first four slots of the same palette used
 *    by OutstandingPaymentsDonut. All four PASS lightness band, chroma floor,
 *    CVD separation (worst adjacent ΔE 35.3 protan) and 3:1 contrast on dark.
 *    The stock --chart-1..5 vars FAIL on this surface — do not use them here.
 *  - STATUS (attendance): the reserved status palette. PASSES contrast (all
 *    ≥3:1) and CVD on this surface. It intentionally sits outside the
 *    categorical lightness band — that check is scoped to categorical palettes,
 *    and status steps are fixed/never-themed so they cannot impersonate a
 *    series. Status must therefore always ship with a label, never colour alone.
 *  - SEQUENTIAL (coverage heatmap): a single hue, opacity-ramped. On a dark
 *    surface "near zero" reads as the surface itself and magnitude reads as
 *    increasing luminance — a true one-hue ramp, never a rainbow.
 */

// Categorical — assigned in FIXED order, never cycled.
export const SERIES_WORKING = '#4176f6';
export const SERIES_BREAK   = '#00a86f';
export const SERIES_IDLE    = '#cb7f00';
export const SERIES_PAUSE   = '#a65af1';

// Status — reserved; never reused as a series colour.
export const STATUS_ON_TIME = '#0ca30c';
export const STATUS_LATE    = '#fab219';
export const STATUS_ABSENT  = '#d03b3b';

/** Sequential single hue for magnitude (heatmap). */
export const SEQUENTIAL_HUE = '#4176f6';

// ─── Formatters ──────────────────────────────────────────────────────

/** 9015 → "2h 30m". Compact enough for axis ticks and stat tiles. */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0m';
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/** Hours as a bare number, for axes where the unit is in the label. */
export function toHours(seconds: number): number {
  return Math.round((seconds / 3600) * 10) / 10;
}

export function formatPercent(v: number | null, digits = 0): string {
  if (v === null || !Number.isFinite(v)) return '—';
  return `${(v * 100).toFixed(digits)}%`;
}

/** "2026-07-14" → "14 Jul". Parsed as wall-clock, never shifted by UTC. */
export function formatDateShort(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', timeZone: 'UTC',
  });
}

export const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// ─── Range presets ───────────────────────────────────────────────────

export const MAX_RANGE_DAYS = 90;

export type PresetId = '7d' | '30d' | '90d' | 'this-month' | 'last-month' | 'custom';

export interface DateRange { start: string; end: string }

const iso = (d: Date) => d.toLocaleDateString('en-CA');

function addDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/**
 * Rollups are computed nightly and never cover the current local day, so every
 * range ends YESTERDAY. Anchoring the presets here keeps the UI honest instead
 * of showing today as a zero.
 */
export function yesterdayStr(): string {
  return addDays(iso(new Date()), -1);
}

export function presetRange(preset: PresetId): DateRange {
  const end = yesterdayStr();
  const [y, m] = end.split('-').map(Number);

  switch (preset) {
    case '7d':  return { start: addDays(end, -6), end };
    case '30d': return { start: addDays(end, -29), end };
    case '90d': return { start: addDays(end, -89), end };
    case 'this-month': {
      const first = `${y}-${String(m).padStart(2, '0')}-01`;
      return { start: first, end };
    }
    case 'last-month': {
      const firstOfThis = new Date(Date.UTC(y, m - 1, 1));
      const lastMonthEnd = new Date(firstOfThis.getTime() - 86_400_000);
      const lm = lastMonthEnd.toISOString().slice(0, 10);
      const [ly, lmo] = lm.split('-').map(Number);
      return { start: `${ly}-${String(lmo).padStart(2, '0')}-01`, end: lm };
    }
    default: return { start: addDays(end, -29), end };
  }
}

export const PRESET_LABELS: Record<Exclude<PresetId, 'custom'>, string> = {
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  '90d': 'Last 90 days',
  'this-month': 'This month',
  'last-month': 'Last month',
};

/** Inclusive day count between two YYYY-MM-DD strings. */
export function rangeDays(start: string, end: string): number {
  const toDay = (s: string) => {
    const [y, m, d] = s.split('-').map(Number);
    return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
  };
  return toDay(end) - toDay(start) + 1;
}

/** Null when the range is valid; otherwise the reason to show the user. */
export function validateRange(start: string, end: string): string | null {
  if (!start || !end) return 'Select a start and end date.';
  if (start > end) return 'Start date must be on or before the end date.';
  const days = rangeDays(start, end);
  if (days > MAX_RANGE_DAYS) return `Range too large: ${days} days (max ${MAX_RANGE_DAYS}).`;
  if (start > yesterdayStr()) return 'Analytics are computed nightly — data ends yesterday.';
  return null;
}
