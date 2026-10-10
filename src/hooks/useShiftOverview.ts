'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { getCache, setCache } from '@/lib/queryCache';
import type { ShiftOverviewResponse } from '@/lib/shiftOverview';

const CACHE_KEY = 'bluu_shift_overview_v1';
const CACHE_TTL_MS = 60 * 1000;

/**
 * The settled half of Shift Management → Overview. Fetched once per mount and on
 * an explicit refresh — never on a timer. The live half comes from
 * `useActiveUsers`, which is a snapshot listener and needs no polling.
 */
export function useShiftOverview() {
  const { user } = useAuth();
  const [data, setData] = useState<ShiftOverviewResponse | null>(
    () => getCache<ShiftOverviewResponse>(CACHE_KEY, CACHE_TTL_MS),
  );
  const [loading, setLoading] = useState(data === null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (force = false) => {
    if (!user) return;
    if (!force) {
      const cached = getCache<ShiftOverviewResponse>(CACHE_KEY, CACHE_TTL_MS);
      if (cached) {
        setData(cached);
        setLoading(false);
        return;
      }
    }
    setRefreshing(true);
    setError(null);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch('/api/admin/shift-management/overview', {
        headers: { Authorization: `Bearer ${idToken}` },
        cache: force ? 'no-store' : 'default',
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Request failed: ${res.status}`);
      }
      const body = (await res.json()) as ShiftOverviewResponse;
      setCache(CACHE_KEY, body);
      setData(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the overview');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user]);

  useEffect(() => { load(); }, [load]);

  return useMemo(
    () => ({ data, loading, refreshing, error, refresh: () => load(true) }),
    [data, loading, refreshing, error, load],
  );
}
