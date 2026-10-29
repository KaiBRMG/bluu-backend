/**
 * Time formatting in the VIEWER's timezone (rule 9g) for the training admin page.
 * The console renders every time in the user's configured zone, so these take it
 * explicitly rather than reading the browser's.
 */

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

/** `14:03:27` in `timeZone` — a position in a screen recording. */
export function formatClockTime(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).format(ms);
}
