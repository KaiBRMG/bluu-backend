import type { TestState } from '@/lib/training/types';

/** Time left on a clock: `mm:ss`, or `h:mm:ss` from an hour. */
export function fmtRemaining(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export { minutesOf } from '@/lib/training/modules';

export const STATE_LABEL: Record<TestState, string> = {
  locked: 'Not open yet',
  open: 'Open',
  'in-progress': 'In progress',
  submitted: 'Submitted',
  'timed-out': "Time's up",
  missed: 'Missed',
};

/** A state after which nothing more can be done on the test. */
export const TERMINAL: ReadonlySet<TestState> = new Set(['submitted', 'timed-out', 'missed']);
