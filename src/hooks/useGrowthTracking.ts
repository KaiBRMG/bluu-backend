'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { useAuthFetch } from '@/hooks/useAuthFetch';
import { getCache, invalidateCacheByPrefix, setCache } from '@/lib/queryCache';
import type { DayMap } from '@/lib/growth/metrics';
import type { GrowthAccount, GrowthSeries } from '@/types/firestore';
import type { GrowthPlatform } from '@/lib/growth/platform';

const CACHE_PREFIX = 'bluu_growth_';
const CACHE_KEY = `${CACHE_PREFIX}series_v1`;
const CACHE_TTL_MS = 5 * 60 * 1000;

interface GrowthPayload {
  accounts: GrowthAccount[];
  series: GrowthSeries[];
}

export interface AddGrowthAccountPayload {
  platform: GrowthPlatform;
  profileUrl: string;
}

/**
 * Growth Tracking data: every tracked account plus its full history.
 *
 * The whole history is fetched once and sliced client-side. That is deliberate:
 * a year of readings for a dozen accounts is a few tens of KB, while re-fetching
 * per range flick would be a Firestore read per click for data already in
 * memory. The range control is a pure filter, so it is also instant.
 *
 * Cached in sessionStorage for 5 minutes like the other SMM hooks. The data only
 * changes once a night, so a stale-by-minutes view costs nothing.
 */
export function useGrowthTracking() {
  const { user } = useAuth();
  const authFetch = useAuthFetch();

  const [accounts, setAccounts] = useState<GrowthAccount[]>([]);
  const [series, setSeries] = useState<GrowthSeries[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = useCallback(async (forceRefresh = false) => {
    if (!forceRefresh) {
      const cached = getCache<GrowthPayload>(CACHE_KEY, CACHE_TTL_MS);
      if (cached) {
        setAccounts(cached.accounts);
        setSeries(cached.series);
        setLoading(false);
        return;
      }
    }
    setLoading(true);
    setError(null);
    try {
      const data = await authFetch('/api/smm/growth/series') as GrowthPayload;
      setAccounts(data.accounts);
      setSeries(data.series);
      setCache(CACHE_KEY, data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load growth data');
    } finally {
      setLoading(false);
    }
  }, [authFetch]);

  useEffect(() => {
    if (!user) return;
    fetchAll();
  }, [user, fetchAll]);

  const refresh = useCallback(async () => {
    invalidateCacheByPrefix(CACHE_PREFIX);
    await fetchAll(true);
  }, [fetchAll]);

  /**
   * Adding is a network call that scrapes, so it can take 10–30s and can fail
   * with a message the user needs to read ("we could not find that page").
   * The error is thrown, not swallowed — the dialog stays open and shows it.
   */
  const addAccount = useCallback(async (payload: AddGrowthAccountPayload) => {
    await authFetch('/api/smm/growth/accounts', { method: 'POST', body: JSON.stringify(payload) });
    await refresh();
  }, [authFetch, refresh]);

  const setTracking = useCallback(async (id: string, isActive: boolean) => {
    await authFetch(`/api/smm/growth/accounts/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ isActive }),
    });
    await refresh();
  }, [authFetch, refresh]);

  const deleteAccount = useCallback(async (id: string) => {
    await authFetch(`/api/smm/growth/accounts/${id}`, { method: 'DELETE' });
    await refresh();
  }, [authFetch, refresh]);

  /** Account id → day map, the shape everything in `metrics.ts` takes. */
  const seriesById = useMemo(() => {
    const map = new Map<string, DayMap>();
    for (const s of series) map.set(s.accountId, s.days);
    return map;
  }, [series]);

  return useMemo(() => ({
    accounts,
    seriesById,
    loading,
    error,
    refresh,
    addAccount,
    setTracking,
    deleteAccount,
  }), [accounts, seriesById, loading, error, refresh, addAccount, setTracking, deleteAccount]);
}
