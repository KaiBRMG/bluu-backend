import type { PartState } from '@/lib/training/types';

/** The candidate's own local time — a browser formatter, never a stored zone. */
export function fmtWhen(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function minutesOf(ms: number): number {
  return Math.round(ms / 60_000);
}

export const STATE_LABEL: Record<PartState, string> = {
  scheduled: 'Not open yet',
  'not-ready': 'Being prepared',
  open: 'Ready to start',
  'in-progress': 'In progress',
  submitted: 'Submitted',
  'timed-out': 'Time ran out',
  missed: 'Missed',
};

/** A state after which nothing more can be done on the part. */
export const TERMINAL: ReadonlySet<PartState> = new Set(['submitted', 'timed-out', 'missed']);
