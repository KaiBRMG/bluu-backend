/**
 * Input quality — is the keyboard input in a screenshot window plausibly a
 * person's?
 *
 * Pure and dependency-free. The Electron main process only *collects* (when a
 * key went down, and which **kind** of key — never which key); everything that
 * decides what looks machine-made lives here, in the web bundle, so a threshold
 * can be tuned with a Vercel deploy instead of an app release. The renderer
 * runs it at each screenshot and the result rides on that capture's upload.
 *
 * Two signals, both **display only** — neither changes idle state, worked time
 * or pay (documentation/time-tracking.md §4b):
 *
 * - **Modifier-only minutes** — a working minute whose only keys were modifiers
 *   (Shift, Ctrl, Cmd, Alt, Caps Lock) or filler keys nobody types with
 *   (F13–F24, Scroll Lock, Num Lock). The signature of a key jiggler that taps
 *   Shift or F15 to keep a session awake.
 * - **Regular-rhythm minutes** — a stretch where key presses arrive on a
 *   near-constant beat. People type in uneven bursts; a jiggler is a metronome.
 *   Only *slow* regular input counts (median gap ≥ 2s): continuous typing
 *   sampled at one-second resolution (the macOS fallback) is also "regular",
 *   and must never read as a machine.
 */

// ─── Raw data from the main process ──────────────────────────────────

/**
 * Kind of key, as `electron/main.js` records it: 0 typing, 1 modifier, 2 filler,
 * 3 unknown (macOS without Input Monitoring). Never the key itself — that is
 * what keeps this from being a keylogger. Only "is it typing" matters here.
 */
const KEY_TYPING = 0;
const KEY_UNKNOWN = 3;

/**
 * - `tap`      — macOS event tap (Input Monitoring granted): exact times, key kinds.
 * - `hook`     — Windows low-level hook: exact times, key kinds.
 * - `counters` — macOS without the permission: per-second counts of key-downs
 *   vs modifier changes. Catches a Shift jiggler; cannot tell F15 from typing.
 */
export type InputSource = 'tap' | 'hook' | 'counters';

export type InputPermission = 'granted' | 'denied' | 'not-determined' | 'not-required' | 'unknown';

export interface RawInputEvents {
  source: InputSource | null;
  permission: InputPermission;
  /** When collection started in this process; nothing before it is known. */
  startedAt: number | null;
  /** Flat `[timestampMs, kind, timestampMs, kind, …]`. Sorted ascending. */
  keys: number[];
}

// ─── Thresholds ──────────────────────────────────────────────────────

/** Presses closer than this are one burst (key repeat, chords, fast typing). */
const BURST_GAP_MS = 150;
/** Rhythm is judged over a rolling window this many minutes long. */
const REGULARITY_WINDOW_MIN = 10;
/** A window needs at least this many gaps between bursts before it is judged. */
const REGULARITY_MIN_GAPS = 8;
/** Coefficient of variation (stdev ÷ mean of the gaps) below which a rhythm is machine-like. */
const REGULARITY_MAX_CV = 0.12;
/** Only slow beats count — see the header. */
const REGULARITY_MIN_MEDIAN_GAP_MS = 2_000;

// ─── Summary ─────────────────────────────────────────────────────────

export const INTERVAL_REGULAR = 1;
export const INTERVAL_MODIFIER_ONLY = 2;

/** One screenshot window's input quality. Stored on the capture's first screen doc as `input`. */
export interface InputWindowSummary {
  v: 1;
  source: InputSource;
  permission: InputPermission;
  /** Start of the first one-minute slot; `perMinute[i]` covers `fromMs + i·60s`. */
  fromMs: number;
  /** Working minutes the data covers — the denominator for everything below. */
  minutes: number;
  /** Key presses in those minutes. */
  keys: number;
  modifierOnlyMinutes: number;
  regularMinutes: number;
  /** Key presses per slot; `-1` for a slot that was not a working minute. */
  perMinute: number[];
  /** Flat `[startMs, endMs, kind, …]`, kind `INTERVAL_REGULAR` / `INTERVAL_MODIFIER_ONLY`. */
  intervals: number[];
}

const MINUTE = 60_000;

function coefficientOfVariation(values: number[]): number {
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  if (mean <= 0) return Infinity;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance) / mean;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Merge flagged slots into `[start, end, kind]` triples. */
function slotsToIntervals(flags: boolean[], fromMs: number, kind: number): number[] {
  const out: number[] = [];
  let runStart = -1;
  for (let i = 0; i <= flags.length; i++) {
    if (i < flags.length && flags[i]) {
      if (runStart < 0) runStart = i;
    } else if (runStart >= 0) {
      out.push(fromMs + runStart * MINUTE, fromMs + i * MINUTE, kind);
      runStart = -1;
    }
  }
  return out;
}

/**
 * Summarise one screenshot window. `isWorking(ms)` says whether the session was
 * in the working state at that instant — idle, break and pause minutes are left
 * out of every count, the same rule activity % follows.
 *
 * Returns `null` when there is nothing honest to say: no collector, or no
 * working minute the collector was running for. Never a zeroed summary — "we
 * did not measure" and "nothing suspicious" are different facts.
 */
export function summariseInputWindow(
  raw: RawInputEvents | null | undefined,
  windowStart: number,
  windowEnd: number,
  isWorking: (ms: number) => boolean,
): InputWindowSummary | null {
  if (!raw?.source || raw.startedAt === null) return null;
  const fromMs = Math.max(windowStart, raw.startedAt);
  if (windowEnd - fromMs < MINUTE) return null;

  const slotCount = Math.floor((windowEnd - fromMs) / MINUTE);
  const working = Array.from({ length: slotCount }, (_, i) => isWorking(fromMs + i * MINUTE + MINUTE / 2));
  const minutes = working.filter(Boolean).length;
  if (minutes === 0) return null;

  const total = new Array<number>(slotCount).fill(0);
  const typing = new Array<number>(slotCount).fill(0);
  const onsets: number[] = [];
  let lastKey = -Infinity;
  for (let i = 0; i + 1 < raw.keys.length; i += 2) {
    const t = raw.keys[i];
    const kind = raw.keys[i + 1];
    if (t < fromMs || t >= fromMs + slotCount * MINUTE) continue;
    const slot = Math.floor((t - fromMs) / MINUTE);
    if (!working[slot]) continue;
    total[slot] += 1;
    if (kind === KEY_TYPING || kind === KEY_UNKNOWN) typing[slot] += 1;
    if (t - lastKey >= BURST_GAP_MS) onsets.push(t);
    lastKey = t;
  }

  const modifierOnly = total.map((n, i) => working[i] && n > 0 && typing[i] === 0);

  // Rhythm: every rolling window of REGULARITY_WINDOW_MIN slots is judged on the
  // gaps between bursts inside it; a machine-like window flags all its slots.
  // Onsets are ascending, so the window's slice is tracked with two pointers.
  const regular = new Array<boolean>(slotCount).fill(false);
  let first = 0;
  let last = 0;
  for (let end = 0; end < slotCount; end++) {
    const start = Math.max(0, end - REGULARITY_WINDOW_MIN + 1);
    const lo = fromMs + start * MINUTE;
    const hi = fromMs + (end + 1) * MINUTE;
    while (first < onsets.length && onsets[first] < lo) first++;
    while (last < onsets.length && onsets[last] < hi) last++;
    const inWindow = onsets.slice(first, last);
    if (inWindow.length - 1 < REGULARITY_MIN_GAPS) continue;
    const gaps = inWindow.slice(1).map((t, i) => t - inWindow[i]);
    if (median(gaps) < REGULARITY_MIN_MEDIAN_GAP_MS) continue;
    if (coefficientOfVariation(gaps) >= REGULARITY_MAX_CV) continue;
    for (let s = start; s <= end; s++) if (working[s]) regular[s] = true;
  }

  return {
    v: 1,
    source: raw.source,
    permission: raw.permission,
    fromMs,
    minutes,
    keys: total.reduce((s, n) => s + n, 0),
    modifierOnlyMinutes: modifierOnly.filter(Boolean).length,
    regularMinutes: regular.filter(Boolean).length,
    perMinute: total.map((n, i) => (working[i] ? n : -1)),
    intervals: [
      ...slotsToIntervals(regular, fromMs, INTERVAL_REGULAR),
      ...slotsToIntervals(modifierOnly, fromMs, INTERVAL_MODIFIER_ONLY),
    ],
  };
}

// ─── Server-side validation ──────────────────────────────────────────

const SOURCES: readonly InputSource[] = ['tap', 'hook', 'counters'];
const PERMISSIONS: readonly InputPermission[] = ['granted', 'denied', 'not-determined', 'not-required', 'unknown'];
/** A capture window is ≤ ~30 min in practice; this is a generous ceiling, not a target. */
const MAX_SLOTS = 180;

const isCount = (v: unknown, max: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= max;

/**
 * Parse a client-sent summary. It came from our own renderer, but a request
 * body is still untrusted input (rule 10): every field is type- and
 * bound-checked, and anything malformed drops the whole summary rather than
 * storing half of one.
 */
export function parseInputSummary(raw: unknown): InputWindowSummary | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (r.v !== 1) return null;
  if (!SOURCES.includes(r.source as InputSource)) return null;
  if (!PERMISSIONS.includes(r.permission as InputPermission)) return null;
  if (typeof r.fromMs !== 'number' || !Number.isFinite(r.fromMs)) return null;
  if (!isCount(r.minutes, MAX_SLOTS) || r.minutes === 0) return null;
  if (!isCount(r.keys, 1_000_000)) return null;
  if (!isCount(r.modifierOnlyMinutes, r.minutes) || !isCount(r.regularMinutes, r.minutes)) return null;
  if (!Array.isArray(r.perMinute) || r.perMinute.length > MAX_SLOTS) return null;
  if (!r.perMinute.every(n => n === -1 || isCount(n, 100_000))) return null;
  if (!Array.isArray(r.intervals) || r.intervals.length > MAX_SLOTS * 3 || r.intervals.length % 3 !== 0) return null;
  if (!r.intervals.every(n => typeof n === 'number' && Number.isFinite(n))) return null;
  return {
    v: 1,
    source: r.source as InputSource,
    permission: r.permission as InputPermission,
    fromMs: r.fromMs,
    minutes: r.minutes,
    keys: r.keys,
    modifierOnlyMinutes: r.modifierOnlyMinutes,
    regularMinutes: r.regularMinutes,
    perMinute: r.perMinute as number[],
    intervals: r.intervals as number[],
  };
}
