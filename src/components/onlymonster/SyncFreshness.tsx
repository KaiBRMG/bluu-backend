'use client';

import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ApiError, useAuthFetch } from '@/hooks/useAuthFetch';
import { useViewerTimezone } from '@/hooks/useViewerTimezone';
import { invalidateCacheByPrefix } from '@/lib/queryCache';
import { formatRelative } from '@/lib/salary/salaryFormat';
import { DataFreshness, type FreshnessStatus } from './DataFreshness';

/**
 * One status request per page, however many headers ask (CA Admin → Sales and
 * the dispute dialog can mount together); concurrent first fetches would each
 * miss the browser cache and reach the origin.
 */
let inflight: Promise<FreshnessStatus | null> | null = null;

/**
 * Every session cache a sync can make stale: sales (admin and agent), salary
 * months, the CA overview and the analytics pages. Salary is derived on read,
 * so dropping these is all "update the salaries" needs (rule 9f).
 */
const SALES_CACHE_PREFIXES = [
  'bluu_admin_sales_v2:',
  'bluu_salary_sales_v2:',
  'bluu_salary_month_v1:',
  'bluu_ca_overview_v3:',
  'bluu_bx_analytics_v1:',
];

/**
 * `DataFreshness` for a page header: reads `/api/onlymonster/status` and shows
 * when the data on screen was synced. A failed read renders nothing rather than
 * a false claim.
 *
 * With `onRefreshed`, it also offers a refresh (CA Admin → Sales and the Sales
 * Report only): `POST /api/onlymonster/refresh` runs the sync now — about a
 * minute — then clears the sales and salary caches and calls `onRefreshed` so
 * the page reloads its own figures. The figures stay on screen while it runs
 * (stale is not empty). The server answers "already up to date" inside a
 * two-minute cooldown and refuses a second run while one holds the lease.
 */
export function SyncFreshness({ className, onRefreshed }: { className?: string; onRefreshed?: () => void }) {
  const authFetch = useAuthFetch();
  const { timezone } = useViewerTimezone();
  const [status, setStatus] = useState<FreshnessStatus | null>(null);
  const [syncing, setSyncing] = useState(false);

  const loadStatus = useCallback(
    async (fresh: boolean) => {
      if (fresh || !inflight) {
        inflight = (authFetch('/api/onlymonster/status', fresh ? { cache: 'no-store' } : {}) as Promise<FreshnessStatus>)
          .catch(() => null)
          .finally(() => setTimeout(() => (inflight = null), 0));
      }
      return inflight;
    },
    [authFetch],
  );

  useEffect(() => {
    let live = true;
    void loadStatus(false).then(body => {
      if (live && body) setStatus(body);
    });
    return () => {
      live = false;
    };
  }, [loadStatus]);

  const refresh = async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      const body = (await authFetch('/api/onlymonster/refresh', { method: 'POST' })) as {
        fresh?: boolean;
        syncedAt?: string;
        partial?: boolean;
        failed?: string[];
      };
      if (body.fresh) {
        toast.success(`Already up to date — synced ${formatRelative(body.syncedAt ?? null)}`);
        return;
      }
      for (const prefix of SALES_CACHE_PREFIXES) invalidateCacheByPrefix(prefix);
      const next = await loadStatus(true);
      if (next) setStatus(next);
      onRefreshed?.();
      if (body.failed?.length) toast.error('Part of the sync failed. The figures shown are the latest that synced.');
      else if (body.partial) toast.success('Sales updated. The rest of the sync finishes within ten minutes.');
      else toast.success('Sales and salaries updated');
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) toast.info(err.message);
      else toast.error(err instanceof Error ? err.message : 'The sync failed');
    } finally {
      setSyncing(false);
    }
  };

  if (!onRefreshed) return <DataFreshness status={status} timezone={timezone} className={className} />;

  return (
    <div className={cn('flex items-center gap-1.5', className)}>
      {syncing ? (
        <span className="text-xs text-zinc-400" aria-live="polite">
          Syncing from OnlyMonster… about a minute
        </span>
      ) : (
        <DataFreshness status={status} timezone={timezone} />
      )}
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => void refresh()}
        disabled={syncing || status?.configured === false}
        aria-label="Refresh sales from OnlyMonster"
        title="Refresh sales from OnlyMonster"
        className="text-zinc-400 hover:text-white"
      >
        <RefreshCw className={cn('size-3.5', syncing && 'activity-spinner animate-spin')} aria-hidden />
      </Button>
    </div>
  );
}
