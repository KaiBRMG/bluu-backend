/**
 * Growth Tracking — "Signals": the accounts that are growing unusually fast
 * right now.
 *
 * Pure, like the rest of `src/lib/growth`: no Firestore, no React. It reads the
 * same day-keyed series everything else does and adds no field to any document —
 * a signal is derived on every render, so there is nothing to keep in sync and
 * nothing to backfill.
 *
 * ── Why a fixed 7-day window, when the page has a range control ─────────────
 * The range control answers "how has the roster done over the period I care
 * about". A signal answers a different question — "what changed *recently*" —
 * and it has to mean the same thing every time it appears, or the strip becomes
 * a restatement of whatever range happens to be selected. Pinning it to a week
 * also matches how the roster is actually reviewed, and it is long enough that a
 * single good night does not trip it.
 *
 * ── Why the threshold is a control and not a constant ───────────────────────
 * There is no correct value. A repost farm doing +12%/week is ordinary; a 684k
 * page doing +12%/week is extraordinary. Rather than pick a number and defend
 * it, the page exposes it and defaults to a figure that produces a useful
 * handful on the current roster. It is view state only — nothing is written.
 */

import { deltaFor, shiftDayKey, todayKey, type DayMap } from './metrics';

/** The window a signal is measured over. Fixed on purpose — see the header. */
export const SPIKE_WINDOW_DAYS = 7;

export const DEFAULT_SPIKE_THRESHOLD = 12;
export const SPIKE_THRESHOLD_MIN = 5;
export const SPIKE_THRESHOLD_MAX = 30;
export const SPIKE_THRESHOLD_STEP = 1;

/**
 * Percentage follower growth over the last {@link SPIKE_WINDOW_DAYS} days, or
 * `null` when it cannot be measured.
 *
 * `null` covers three genuinely different situations that must never be
 * flattened into a `0`: no readings in the window, a single reading (a change
 * needs two), and a zero baseline. `deltaFor` already draws those distinctions,
 * so this is a projection of it rather than a second implementation.
 */
export function spikePercent(days: DayMap, today: string = todayKey()): number | null {
  return deltaFor(days, shiftDayKey(today, -SPIKE_WINDOW_DAYS)).percent;
}

export interface GrowthSignal {
  accountId: string;
  /** Growth over the window, in percent. Always above the active threshold. */
  percent: number;
}

/**
 * The accounts currently above `threshold`, strongest first.
 *
 * Measured across the **whole roster**, deliberately ignoring the page's
 * platform/category filter: the strip's job is to interrupt with something the
 * reader was not already looking at, and one that only reported inside the
 * current filter could never do that. The overview grid below it is the filtered
 * view; this is not.
 *
 * Only positive movement counts. A collapse is worth knowing about too, but it
 * is a different alarm with a different colour and a different threshold, and
 * folding it in here would put "up 20%" and "down 20%" in one undifferentiated
 * row of cards.
 */
export function signalsFor(
  accounts: ReadonlyArray<{ id: string; isActive: boolean }>,
  seriesById: ReadonlyMap<string, DayMap>,
  threshold: number,
  today: string = todayKey(),
): GrowthSignal[] {
  const signals: GrowthSignal[] = [];
  for (const account of accounts) {
    // A stopped account's last week is frozen history, not news.
    if (!account.isActive) continue;
    const percent = spikePercent(seriesById.get(account.id) ?? {}, today);
    if (percent !== null && percent >= threshold) {
      signals.push({ accountId: account.id, percent });
    }
  }
  return signals.sort((a, b) => b.percent - a.percent);
}
