import { zonedTimeToUtcMs } from '@/lib/timezone';

/**
 * Wall-clock ↔ instant conversion in the VIEWER's timezone (rule 9g), for the
 * `datetime-local` inputs on the training admin page.
 *
 * A `datetime-local` value is a wall time with no zone, and the browser would
 * read it in the machine's zone. The console renders every time in the user's
 * configured zone, so the input must mean that same zone or an admin schedules
 * a part for one hour and reads it back as another. The offset is found with
 * the shared `zonedTimeToUtcMs`, which knows the zone's DST rules.
 */

/** `YYYY-MM-DDTHH:mm` (a wall time in `timeZone`) → epoch ms. NaN for an unusable string. */
export function wallToMs(wall: string, timeZone: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(wall);
  if (!m) return NaN;
  return zonedTimeToUtcMs(+m[1], +m[2], +m[3], +m[4], +m[5], 0, timeZone);
}

/** Epoch ms → `YYYY-MM-DDTHH:mm` in `timeZone`, the value format of a `datetime-local` input. */
export function msToWall(ms: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(ms);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}

export function formatWhen(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(ms);
}

/** `18m 04s` — how long something took, for admin read-outs. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}m ${String(total % 60).padStart(2, '0')}s`;
}
