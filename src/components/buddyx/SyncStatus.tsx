'use client';

import { RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useBuddyxSync } from '@/hooks/useBuddyxSync';
import { formatRelative } from '@/lib/salary/salaryFormat';
import type { BuddyxScope } from '@/lib/buddyx/constants';

const timeOnly = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });
const exact = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' });

/**
 * "Synced 4 min ago" + a refresh button, in every BuddyX-backed page header.
 *
 * - **Syncing** spins the icon (`.activity-spinner`, exempt from reduced
 *   motion) and leaves the page's figures readable in place — never skeletoned.
 * - **Failed** turns the label status-orange and says what is on screen
 *   instead: "Sync failed 2h ago · showing data from 09:01". The refresh stays
 *   enabled. Hue here is semantic — it means attention.
 * - **Stale is not empty.** Nothing here ever blanks the page.
 *
 * `onSynced` is the page's reload, run only when a refresh produced new data.
 */
export function SyncStatus({
  scope,
  onSynced,
  className,
}: {
  scope: BuddyxScope;
  onSynced?: () => void;
  className?: string;
}) {
  const { freshness, syncing, refresh, configured } = useBuddyxSync(scope, onSynced);

  const success = freshness?.lastSuccessAt ?? null;
  const attempt = freshness?.lastAttemptAt ?? null;
  const failed = Boolean(freshness?.lastError) && attempt !== null && (!success || attempt > success);

  let label: string;
  if (!configured) label = 'BuddyX not connected';
  else if (syncing) label = 'Syncing…';
  else if (failed)
    label = `Sync failed ${formatRelative(attempt)}${success ? ` · showing data from ${timeOnly.format(new Date(success))}` : ''}`;
  else if (success) label = `Synced ${formatRelative(success)}`;
  else label = 'Not synced yet';

  return (
    <div className={cn('flex items-center gap-1.5', className)}>
      <span
        className={cn('text-[11px] tabular-nums', failed && !syncing ? 'text-orange-400' : 'text-zinc-400')}
        title={success ? `Last synced ${exact.format(new Date(success))}` : undefined}
        aria-live="polite"
      >
        {label}
      </span>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => void refresh()}
        disabled={syncing || !configured}
        aria-label="Refresh from BuddyX"
        className="text-zinc-400 hover:text-white"
      >
        <RefreshCw className={cn('size-3.5', syncing && 'activity-spinner animate-spin')} aria-hidden />
      </Button>
    </div>
  );
}
