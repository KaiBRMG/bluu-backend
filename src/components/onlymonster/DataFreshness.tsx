'use client';

import { cn } from '@/lib/utils';
import { safeTimezone } from '@/lib/utils/timezone';

/**
 * "Updated 13:01 · next 21:01". A passive label for data the OnlyMonster sync
 * writes three times a day (migration plan §5.8). Passive: clients read
 * Firestore only. The one refresh (the two sales pages, D26) lives in
 * `SyncFreshness`, which wraps this label.
 *
 * - Failed last run → status-orange, and it says what is on screen instead:
 *   "Last sync failed · showing data from 13:01". Stale is not empty.
 * - Never synced → "Not synced yet".
 * - Not configured → "OnlyMonster not connected", grey: an expected state
 *   during setup, not an incident.
 *
 * Times are in the viewer's zone (rule 9g); the exact instant is in `title`.
 */
export interface FreshnessStatus {
  configured: boolean;
  updatedAt: string | null;
  nextRunAt: string;
  lastRunOk: boolean | null;
}

export function DataFreshness({ status, timezone, className }: { status: FreshnessStatus | null; timezone: string; className?: string }) {
  const tz = safeTimezone(timezone);
  const time = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: tz });
  const exact = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: tz });
  const dayOf = new Intl.DateTimeFormat('en-CA', { timeZone: tz });
  const at = (iso: string) => {
    const d = new Date(iso);
    const sameDay = dayOf.format(d) === dayOf.format(new Date());
    return sameDay ? time.format(d) : exact.format(d);
  };

  if (!status) return null;

  let text: string;
  let attention = false;
  if (!status.configured) text = 'OnlyMonster not connected';
  else if (!status.updatedAt) text = 'Not synced yet';
  else if (status.lastRunOk === false) {
    text = `Last sync failed · showing data from ${at(status.updatedAt)}`;
    attention = true;
  } else text = `Updated ${at(status.updatedAt)} · next ${time.format(new Date(status.nextRunAt))}`;

  return (
    <span
      className={cn('text-xs tabular-nums', attention ? 'text-orange-400' : 'text-zinc-400', className)}
      title={status.updatedAt ? `Data from ${exact.format(new Date(status.updatedAt))}` : undefined}
    >
      {text}
    </span>
  );
}
