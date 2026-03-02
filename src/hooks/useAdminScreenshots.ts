'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { getCache, setCache } from '@/lib/queryCache';

export interface ScreenshotScreen {
  id: string;
  timestampUTC: string;
  url: string;
  thumbnailUrl: string;
  screenIndex: number;
}

export interface ScreenshotGroup {
  captureGroup: string;
  timestampUTC: string;
  screenCount: number;
  screens: ScreenshotScreen[];
}

interface ScreenshotsCacheData {
  groups: ScreenshotGroup[];
}

interface UseAdminScreenshotsReturn {
  groups: ScreenshotGroup[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

function cacheKey(userId: string, date: string): string {
  return `bluu_screenshots_v1:${userId}:${date}`;
}

export function useAdminScreenshots(
  userId: string | null,
  date: string | null,
): UseAdminScreenshotsReturn {
  const { user } = useAuth();
  const [groups, setGroups] = useState<ScreenshotGroup[]>(() => {
    if (!userId || !date) return [];
    const cached = getCache<ScreenshotsCacheData>(cacheKey(userId, date), CACHE_TTL_MS);
    return cached?.groups ?? [];
  });
  const [loading, setLoading] = useState<boolean>(() => {
    if (!userId || !date) return false;
    const cached = getCache<ScreenshotsCacheData>(cacheKey(userId, date), CACHE_TTL_MS);
    return !cached;
  });
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async (forceRefresh = false) => {
    if (!user || !userId || !date) {
      setGroups([]);
      return;
    }

    if (!forceRefresh) {
      const cached = getCache<ScreenshotsCacheData>(cacheKey(userId, date), CACHE_TTL_MS);
      if (cached) {
        setGroups(cached.groups);
        setLoading(false);
        return;
      }
    }

    setLoading(true);
    setError(null);
    try {
      const idToken = await user.getIdToken();
      const params = new URLSearchParams({ userId, date });

      const res = await fetch(`/api/time-tracking/screenshots?${params}`, {
        headers: { Authorization: `Bearer ${idToken}` },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Failed: ${res.status}`);
      }
      const data = await res.json();
      const fetched: ScreenshotGroup[] = data.groups || [];
      setCache<ScreenshotsCacheData>(cacheKey(userId, date), { groups: fetched });
      setGroups(fetched);
    } catch (err) {
      console.error('[useAdminScreenshots] Fetch failed:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [user, userId, date]);

  useEffect(() => { fetchData(); }, [fetchData]);

  return { groups, loading, error, refetch: () => fetchData(true) };
}
