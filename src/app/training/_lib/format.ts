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
