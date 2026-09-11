import type { GoLoginSession } from '@/types/electron';

/**
 * Copy and state vocabulary shared by the profile list and the viewer window.
 *
 * Both surfaces render the same session, so the labels live once — the list's
 * row badge and the viewer's header must never disagree about what "starting"
 * means.
 */

/** A closed six-value vocabulary, so it earns hues — borrowed from `STATUS_COLORS`'
 * triad (blue = moving, green = live, zinc = neutral, red = failed) rather than
 * invented, exactly as `disputeStatus.ts` borrows for its derived states. */
export const SESSION_STATES: Record<string, { label: string; dot: string; text: string }> = {
  idle: { label: 'Not started', dot: 'bg-zinc-500', text: 'text-zinc-400' },
  starting: { label: 'Starting', dot: 'bg-blue-400', text: 'text-blue-400' },
  running: { label: 'Running', dot: 'bg-green-400', text: 'text-green-400' },
  stopping: { label: 'Stopping', dot: 'bg-blue-400', text: 'text-blue-400' },
  stopped: { label: 'Stopped', dot: 'bg-zinc-500', text: 'text-zinc-400' },
  failed: { label: 'Failed', dot: 'bg-red-400', text: 'text-red-400' },
};

/**
 * The chip/badge triad this window uses, in one place.
 *
 * The hues are borrowed from `STATUS_COLORS` (green = live, blue = moving, zinc
 * = neutral, red = failed) rather than imported: `STATUS_COLORS` is keyed by
 * `CRStatus` and has no member that means "a browser is open". What was drifting
 * was not the hue but the *recipe* — the same four foreground/wash pairs were
 * retyped in the list, the members panel and the close guard, and a fifth
 * spelling would have been invisible until two surfaces disagreed on screen.
 */
export const TONE_CHIP: Record<'green' | 'blue' | 'zinc' | 'red', string> = {
  green: 'bg-green-500/10 text-green-400',
  blue: 'bg-blue-500/10 text-blue-400',
  zinc: 'bg-white/[0.08] text-zinc-300',
  red: 'bg-red-500/10 text-red-400',
};

export const SESSION_ERRORS: Record<string, string> = {
  forbidden: 'You do not have access to GoLogin.',
  // The failure this whole subsystem is built to survive. GoLogin rejects a
  // token outright on 401 and *revokes* it on a rate-limit breach, so both land
  // here and both have the same remedy: a new key. This string is the fallback
  // for places that only show a line; the list renders a whole screen for it,
  // because "Retry" is the one action that cannot possibly work.
  'invalid-token':
    'GoLogin is no longer accepting your API token. Create a new one in GoLogin and paste it in again.',
  unauthenticated: 'Your session expired. Sign in again from the main Bluu window.',
  'not-configured': 'GoLogin is not configured on the server.',
  'not-linked': 'Add your GoLogin API key before launching a profile.',
  // The named-holder version of this is built at the call site, where the name
  // is available; this is the fallback for a claim whose holder is unknown.
  'in-use': 'Someone else has this profile open. It frees up when they close it.',
  'lock-failed': 'Could not check whether anyone else has this profile open. Try again.',
  timeout:
    'The browser did not start in time. The first launch downloads it — try again, it resumes where it left off.',
  'too-many-sessions': 'Too many profiles are already running. Stop one and try again.',
  'invalid-profile': 'That profile id is not valid.',
  // The most common launch failure by far, and the only one with a remedy the
  // operator can act on themselves — so it names the fix rather than the fault.
  'proxy-error':
    "This profile's proxy is not responding. Check or replace it in GoLogin, then try again.",
  'launch-failed': 'GoLogin could not start this profile.',
  'stop-failed': 'The browser did not close cleanly. Close its window by hand.',
  unsupported: 'This version of the desktop app cannot launch profiles. Update Bluu and try again.',
  default: 'Something went wrong with this session.',
};

export function sessionErrorMessage(code?: string | null): string {
  return (code && SESSION_ERRORS[code]) || SESSION_ERRORS.default;
}

export function isLive(session?: GoLoginSession): boolean {
  return session?.status === 'running' || session?.status === 'starting';
}
