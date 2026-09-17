'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuthFetch } from '@/hooks/useAuthFetch';
import type { ApifyUsageReport } from '@/types/firestore';

/**
 * A month of measured Apify spend, for the Usage dialog.
 *
 * Deliberately **not** fetched on page mount. Nobody opens Growth Tracking to
 * read the bill, and the report is a few hundred run rows — loading it for
 * every visit would be a payload and a round trip spent on a dialog most
 * sessions never open. The hook is driven by `month`, and passing `null` (which
 * is what a closed dialog passes) fetches nothing at all.
 *
 * No sessionStorage cache either: the server already caches the month for 15
 * minutes and this is the surface where a person specifically wants to know
 * whether the number moved. A second cache in front of it would mean pressing
 * Refresh and being shown the same stale figure.
 */
export function useApifyUsage(month: string | null) {
  const authFetch = useAuthFetch();

  const [usage, setUsage] = useState<ApifyUsageReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (target: string, force: boolean) => {
    if (force) setRefreshing(true); else setLoading(true);
    setError(null);
    try {
      const data = await authFetch(
        `/api/smm/growth/usage?month=${target}${force ? '&refresh=1' : ''}`,
      ) as { usage: ApifyUsageReport };
      setUsage(data.usage);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load usage from Apify');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [authFetch]);

  useEffect(() => {
    if (!month) return;
    /**
     * The previous month's figures are cleared before the new ones arrive.
     * Leaving them on screen under a new month's heading would state a cost for
     * a period that did not produce it — the one failure this surface cannot
     * afford, since its entire purpose is that a displayed figure is real.
     */
    setUsage(null);
    load(month, false);
  }, [month, load]);

  const refresh = useCallback(async () => {
    if (month) await load(month, true);
  }, [month, load]);

  return { usage, loading, refreshing, error, refresh };
}
