'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { useAuthFetch } from '@/hooks/useAuthFetch';
import { getCache, setCache } from '@/lib/queryCache';

/** The routes are browser-cached for 60s too; this keeps a tab flip free. */
const TTL_MS = 60_000;

/**
 * One BuddyX-backed route, read through `queryCache` (60s), the way the salary
 * surfaces read theirs. `reload(true)` forces past both caches — the refresh
 * button's `onSynced`. A forced reload keeps the current figures on screen
 * (stale is not empty); a new URL clears them. A failed read is a state, never
 * an empty page.
 */
export function useBuddyxAnalytics<T>(url: string | null) {
  const { user } = useAuth();
  const authFetch = useAuthFetch();
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(
    async (force = false) => {
      if (!user || !url) return;
      const key = `bluu_bx_analytics_v1:${user.uid}:${url}`;
      if (!force) {
        const cached = getCache<T>(key, TTL_MS);
        if (cached) {
          setData(cached);
          setLoading(false);
          setError(null);
          return;
        }
        setData(null);
        setLoading(true);
      }
      setError(null);
      try {
        const body = (await authFetch(url, { cache: force ? 'no-store' : 'default' })) as T;
        setCache(key, body);
        setData(body);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not load');
      } finally {
        setLoading(false);
      }
    },
    [user, url, authFetch],
  );

  useEffect(() => {
    void reload();
  }, [reload]);

  return { data, loading, error, reload };
}
