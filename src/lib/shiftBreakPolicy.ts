/**
 * Shift-edge break restriction: a user with a scheduled shift may not start a
 * break during the first or last hour of it.
 *
 * Organization-wide only (no group/user override) and default OFF. Stored at
 * `org-settings/shift-breaks`, read by `GET /api/time-tracking/break-policy`,
 * which turns the caller's shift occurrences into blocked windows. The renderer
 * evaluates those windows locally so pressing Break is never gated on a network
 * call (time-tracking.md §3c).
 *
 * Applies ONLY to time inside a scheduled shift (Admin → Shift Management).
 * Someone who tracks time without a shift gets no windows and is never affected.
 *
 * Pure so the route and the renderer share it.
 * See documentation/time-tracking.md §3g.
 */

import { safeTimezone } from './utils/timezone';

export interface ShiftBreakPolicy {
  restrictBreaksAtShiftEdges: boolean;
}

export const DEFAULT_SHIFT_BREAK_POLICY: ShiftBreakPolicy = {
  restrictBreaksAtShiftEdges: false,
};

/** How long each edge of a shift is closed to breaks. */
export const SHIFT_EDGE_NO_BREAK_MS = 60 * 60 * 1000;

export function normalizeShiftBreakPolicy(raw: unknown): ShiftBreakPolicy {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    restrictBreaksAtShiftEdges:
      typeof src.restrictBreaksAtShiftEdges === 'boolean'
        ? src.restrictBreaksAtShiftEdges
        : DEFAULT_SHIFT_BREAK_POLICY.restrictBreaksAtShiftEdges,
  };
}

export type BreakBlockReason = 'shift-start' | 'shift-end';

export interface BreakBlockWindow {
  /** ms UTC, inclusive */
  start: number;
  /** ms UTC, exclusive */
  end: number;
  reason: BreakBlockReason;
}

/**
 * Shift spans → the windows in which a break may not start.
 *
 * Touching or overlapping spans are merged first, so back-to-back shifts (a
 * regular shift followed by cover) are one continuous shift: the seam between
 * them is not a "last hour" and a "first hour".
 */
export function computeBreakBlockWindows(
  spans: Array<{ start: number; end: number }>,
  edgeMs: number = SHIFT_EDGE_NO_BREAK_MS,
): BreakBlockWindow[] {
  const sorted = spans
    .filter(s => Number.isFinite(s.start) && Number.isFinite(s.end) && s.end > s.start)
    .sort((a, b) => a.start - b.start);

  const merged: Array<{ start: number; end: number }> = [];
  for (const s of sorted) {
    const last = merged.at(-1);
    if (last && s.start <= last.end) last.end = Math.max(last.end, s.end);
    else merged.push({ ...s });
  }

  const windows: BreakBlockWindow[] = [];
  for (const { start, end } of merged) {
    // A shift shorter than two edges is closed to breaks end to end.
    windows.push({ start, end: Math.min(start + edgeMs, end), reason: 'shift-start' });
    windows.push({ start: Math.max(end - edgeMs, start), end, reason: 'shift-end' });
  }
  return windows;
}

/**
 * The window blocking a break at `nowMs`, or null when a break is allowed.
 * Where windows overlap (a short shift), the one that ends last wins, so the
 * "until" shown to the user is when a break actually becomes possible.
 */
export function breakBlockAt(windows: readonly BreakBlockWindow[], nowMs: number): BreakBlockWindow | null {
  let best: BreakBlockWindow | null = null;
  for (const w of windows) {
    if (nowMs >= w.start && nowMs < w.end && (!best || w.end > best.end)) best = w;
  }
  return best;
}

/** The next instant after `nowMs` at which `breakBlockAt` can change, or null. */
export function nextBreakBlockBoundary(windows: readonly BreakBlockWindow[], nowMs: number): number | null {
  let next: number | null = null;
  for (const w of windows) {
    for (const t of [w.start, w.end]) {
      if (t > nowMs && (next === null || t < next)) next = t;
    }
  }
  return next;
}

/** Tooltip on a Break button disabled by this policy. */
export const BREAK_BLOCKED_TOOLTIP = 'Breaks are not available during the first and last hour of your shift';

/** User-facing copy for a block, with the unlock time in the viewer's zone. */
export function breakBlockMessage(block: BreakBlockWindow, timezone: string | null | undefined): { title: string; detail: string } {
  const at = new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: safeTimezone(timezone),
  }).format(block.end);
  return block.reason === 'shift-start'
    ? { title: 'No breaks in the first hour of your shift', detail: `Breaks open at ${at}.` }
    : { title: 'No breaks in the last hour of your shift', detail: `Your shift ends at ${at}.` };
}
