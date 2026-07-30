/**
 * Electron window sizing policy (renderer side).
 *
 * The spec, in one line: **auto-size by default; once the user resizes by hand that size
 * sticks and auto-sizing never runs again — until they log in again.**
 *
 * - **No saved size** → auto-size to 85% × 80% of the display work area (bounded by a
 *   usable minimum). This is the default state, so it runs on every launch.
 * - **User manually resizes** → the outer size is written to a single localStorage key.
 *   From then on, login *restores* that size and the auto-size is skipped. A **maximized**
 *   window persists its maximize state, never its bounds (see rule 1).
 * - **Logout** clears the key, so the next login auto-sizes again.
 *
 * The presence of the key is the entire "has the user chosen a size?" signal, which is why
 * it must only ever be written from a genuine user resize. The renderer therefore persists
 * from the main process's `onUserResized` event, **not** the DOM `resize` event — the DOM
 * event also fires for the auto-size itself, which would persist the auto-sized value and
 * permanently disable auto-sizing.
 *
 * A single (non-per-uid) key is intentional: the spec wants the size forgotten on logout,
 * and a shared key cleared at logout is the exact implementation.
 *
 * Two further rules exist because both were, at different times, the cause of windows
 * opening larger than the user's screen:
 *
 * 1. **Never persist maximized bounds.** On Windows a maximized window's outer bounds
 *    include the invisible resize border, so replaying them on an un-maximized window
 *    produces a window wider than the display. `maximized` is stored as a flag alongside
 *    the last *non-maximized* size.
 * 2. **Prefer the main process for display geometry.** `window.screen.avail*` is in CSS
 *    pixels, which the forced 90% zoom (`setZoomFactor(0.9)` in `electron/main.js`) skews,
 *    and it describes whichever display Chromium considers current. `window.getWorkArea()`
 *    reports the real work area of the display the window is on, in the same DIP units
 *    `setSize` consumes. The `window.screen` path is only a fallback for older installed
 *    builds that lack the IPC; the main process clamps anything we send it.
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

/** Persisted shape: the last *restored* (non-maximized) size, plus the maximize state. */
export interface SavedWindowState extends WindowSize {
  maximized?: boolean;
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

/**
 * The display work area in DIPs, from the main process when available. Falls back to
 * `window.screen.avail*` on builds predating `window:get-work-area`.
 */
export async function readWorkArea(): Promise<WindowSize> {
  try {
    const wa = await window.electronAPI?.window?.getWorkArea?.();
    if (wa && wa.width > 0 && wa.height > 0) return wa;
  } catch {
    // Fall through to the renderer-side approximation.
  }
  return { width: window.screen.availWidth, height: window.screen.availHeight };
}

/** Fit a size inside the work area, keeping the usable minimum where the display allows. */
export function fitToWorkArea(size: WindowSize, workArea: WindowSize): WindowSize {
  return {
    width: clamp(Math.round(size.width), Math.min(MIN_W, workArea.width), workArea.width),
    height: clamp(Math.round(size.height), Math.min(MIN_H, workArea.height), workArea.height),
  };
}

/** Compute the dynamic default size (85% × 80%) from a work area. */
export function computeDynamicSize(workArea: WindowSize): WindowSize {
  return fitToWorkArea(
    {
      width: workArea.width * WIDTH_RATIO,
      height: workArea.height * HEIGHT_RATIO,
    },
    workArea,
  );
}

/** Read the remembered window state, or null if none/invalid. */
export function readSavedSize(): SavedWindowState | null {
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
      return {
        width: parsed.width,
        height: parsed.height,
        maximized: parsed.maximized === true,
      };
    }
  } catch {
    // Corrupt value — treat as no saved size.
  }
  return null;
}

/**
 * Persist the user's chosen (outer) window size. `width`/`height` must always be the
 * last **restored** size — never maximized bounds.
 */
export function saveSize(width: number, height: number, maximized = false): void {
  try {
    localStorage.setItem(WINDOW_SIZE_KEY, JSON.stringify({ width, height, maximized }));
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
