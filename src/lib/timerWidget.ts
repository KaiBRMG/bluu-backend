/**
 * Timer widget bridge — the renderer's half of the always-visible session timer
 * (macOS menu-bar tray title, Windows docked HUD window).
 *
 * ## Why this pushes an ANCHOR, not a number
 *
 * The widget must agree with the time-tracking page to the second, forever. The
 * obvious implementation — tick in the renderer and push the formatted string
 * every second — fails that on two counts: it burns an IPC per second, and it
 * freezes exactly when the renderer's own 1s tick freezes (a heavy page load
 * blocks the main thread; see the display self-heal in TimeTrackingContext).
 *
 * So instead of pushing the *result*, this pushes the *inputs the result is
 * derived from* — a base and the wall-clock instant that base was true — and the
 * main process re-derives the display each second with the identical formula.
 * The two clocks cannot drift, because they are the same arithmetic over the
 * same anchor rather than two copies of a number. It also means one IPC per
 * state transition instead of one per second.
 *
 * Consequently the payload mirrors TimeTrackingContext's own tick exactly:
 *
 * | displayState | mode       | baseSeconds                   | anchorMs       |
 * |--------------|------------|-------------------------------|----------------|
 * | working      | count-up   | sessionBaseSecondsRef         | entryStartTime |
 * | on-break     | count-down | break allowance left at start  | breakStartTime |
 * | idle, paused | frozen     | sessionBaseSecondsRef          | —              |
 * | clocked-out  | (hidden)   | —                             | —              |
 *
 * `idle`/`paused` are `frozen` because the session clock genuinely stops there —
 * that is the same reason the page renders `sessionBaseSecondsRef` for them.
 */

import { STATE_CONFIG } from '@/lib/stateColors';
import type { TimerDisplayState } from '@/types/firestore';

/** Every state the widget renders. `clocked-out` is not one of them — it hides. */
export type TimerWidgetState = Exclude<TimerDisplayState, 'clocked-out'>;

export type TimerWidgetMode = 'count-up' | 'count-down' | 'frozen';

export interface TimerWidgetPayload {
  visible: boolean;
  state?: TimerWidgetState;
  mode?: TimerWidgetMode;
  /** Seconds on the clock at `anchorMs` (the whole value when `frozen`). */
  baseSeconds?: number;
  /** Wall-clock ms at which `baseSeconds` was true. Omitted when `frozen`. */
  anchorMs?: number;
  /** State hue, always read from STATE_CONFIG so no hex is re-typed natively. */
  color?: string;
  /** Human label for the tray tooltip ("Working", "On Break", …). */
  label?: string;
}

const HIDDEN: TimerWidgetPayload = { visible: false };

/**
 * Build the payload for the current tracker state, or the hidden payload when
 * the user is clocked out (an explicit requirement — the widget must never show
 * a clocked-out session) or has switched the feature off in App Settings.
 */
export function buildTimerWidgetPayload(input: {
  enabled: boolean;
  displayState: TimerDisplayState;
  /** Working seconds banked before the current segment. */
  workedBaseSeconds: number;
  /** Start of the current working segment; null unless `working`. */
  entryStartTime: number | null;
  /** Start of the current break; null unless `on-break`. */
  breakStartTime: number | null;
  /** Break allowance remaining at the instant the break started. */
  breakRemainingAtStartSeconds: number;
}): TimerWidgetPayload {
  const { enabled, displayState } = input;
  if (!enabled || displayState === 'clocked-out') return HIDDEN;

  const shared = {
    visible: true as const,
    state: displayState,
    color: STATE_CONFIG[displayState].color,
    label: STATE_CONFIG[displayState].label,
  };

  if (displayState === 'on-break') {
    // A break with no start time can't be counted down from; freeze at the
    // remaining allowance rather than showing a countdown anchored to nothing.
    if (input.breakStartTime === null) {
      return { ...shared, mode: 'frozen', baseSeconds: input.breakRemainingAtStartSeconds };
    }
    return {
      ...shared,
      mode: 'count-down',
      baseSeconds: input.breakRemainingAtStartSeconds,
      anchorMs: input.breakStartTime,
    };
  }

  if (displayState === 'working' && input.entryStartTime !== null) {
    return {
      ...shared,
      mode: 'count-up',
      baseSeconds: input.workedBaseSeconds,
      anchorMs: input.entryStartTime,
    };
  }

  // idle, paused, and the brief window where `working` has no segment start yet.
  return { ...shared, mode: 'frozen', baseSeconds: input.workedBaseSeconds };
}

/**
 * Hand the payload to the shell. Feature-detected: absent on every installed
 * build older than the one that shipped the widget, and on a browser, where it
 * is simply a no-op.
 */
export function pushTimerWidgetState(payload: TimerWidgetPayload): void {
  if (typeof window === 'undefined') return;
  window.electronAPI?.timerWidget?.update?.(payload);
}

/** Tear the widget down (clock-out, sign-out, provider unmount, feature off). */
export function hideTimerWidget(): void {
  pushTimerWidgetState(HIDDEN);
}
