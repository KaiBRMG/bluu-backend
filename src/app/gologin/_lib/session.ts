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

export const SESSION_ERRORS: Record<string, string> = {
  forbidden: 'You do not have access to GoLogin.',
  unauthenticated: 'Your session expired. Sign in again from the main Bluu window.',
  'not-configured': 'GoLogin is not configured on the server (GL_API_TOKEN is missing).',
  timeout:
    'The browser did not start in time. The first launch downloads it — try again, it resumes where it left off.',
  'too-many-sessions': 'Too many profiles are already running. Stop one and try again.',
  'invalid-profile': 'That profile id is not valid.',
  'launch-failed': 'GoLogin could not start this profile. It may already be running elsewhere.',
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
