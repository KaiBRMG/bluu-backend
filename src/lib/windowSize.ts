/**
 * Electron window sizing policy (renderer side).
 *
 * Behavior:
 * - First launch (no saved size): the window is sized to 85% × 80% of the display's
 *   work area (bounded by a usable minimum). Because the remembered size is cleared on
 *   logout, every fresh login re-runs this dynamic sizing.
 * - When the user resizes, the outer window size is saved to a single localStorage key.
 * - On logout the key is cleared, so the next launch re-runs the dynamic 85/80 sizing.
 *
 * A single (non-per-uid) key is intentional: the spec wants the size forgotten on logout,
 * and a shared key cleared at logout is the exact implementation.
 */

export const WINDOW_SIZE_KEY = 'bluu_window_size';

const WIDTH_RATIO = 0.85;
const HEIGHT_RATIO = 0.8;
const MIN_W = 1024;
const MIN_H = 720;

export interface WindowSize {
  width: number;
  height: number;
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

/**
 * Compute the dynamic default size from the current display's available work area
 * (`window.screen.availWidth/availHeight` already excludes the taskbar/dock).
 */
export function computeDynamicSize(): WindowSize {
  const availW = window.screen.availWidth;
  const availH = window.screen.availHeight;
  return {
    width: clamp(Math.round(availW * WIDTH_RATIO), Math.min(MIN_W, availW), availW),
    height: clamp(Math.round(availH * HEIGHT_RATIO), Math.min(MIN_H, availH), availH),
  };
}

/** Read the remembered window size, or null if none/invalid. */
export function readSavedSize(): WindowSize | null {
  try {
    const raw = localStorage.getItem(WINDOW_SIZE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      typeof parsed?.width === 'number' &&
      typeof parsed?.height === 'number' &&
      parsed.width > 0 &&
      parsed.height > 0
    ) {
      return { width: parsed.width, height: parsed.height };
    }
  } catch {
    // Corrupt value — treat as no saved size.
  }
  return null;
}

/** Persist the user's chosen (outer) window size. */
export function saveSize(width: number, height: number): void {
  try {
    localStorage.setItem(WINDOW_SIZE_KEY, JSON.stringify({ width, height }));
  } catch {
    // Storage unavailable — non-fatal; sizing simply won't persist.
  }
}

/** Forget the remembered size (called on logout). */
export function clearSavedSize(): void {
  try {
    localStorage.removeItem(WINDOW_SIZE_KEY);
  } catch {
    // Non-fatal.
  }
}
