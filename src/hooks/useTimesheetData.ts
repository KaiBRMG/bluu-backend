'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { getCache, setCache, invalidateCacheByPrefix } from '@/lib/queryCache';
export interface TimesheetEntry {
  id: string;
  state: 'working' | 'idle' | 'on-break' | 'paused';
  createdTime: string;
  lastTime: string;
}

interface CachedTimesheetData {
  entries: TimesheetEntry[];
  timezone: string;
}

interface UseTimesheetDataReturn {
  entries: TimesheetEntry[];
  timezone: string;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

// sessionStorage TTL: 5 minutes. Short enough that active tracking sessions
// see fresh data after re-navigation, long enough to skip the Firestore query
// when the user immediately navigates back to the page.
const CACHE_TTL_MS = 5 * 60 * 1000;

function cacheKey(uid: string, userId: string | null, startDate: string, endDate: string, timezone: string): string {
  return `bluu_timesheet_v1:${uid}:${userId ?? 'self'}:${startDate}:${endDate}:${timezone}`;
}

export function invalidateTimesheetCache(uid: string): void {
  invalidateCacheByPrefix(`bluu_timesheet_v1:${uid}:`);
}

export function useTimesheetData(
  userId: string | null,
  startDate: string | null,
  endDate: string | null,
  viewerTimezone = 'UTC',
): UseTimesheetDataReturn {
  const { user } = useAuth();
  const [entries, setEntries] = useState<TimesheetEntry[]>([]);
  const [timezone, setTimezone] = useState('UTC');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async (forceRefresh = false) => {
    if (!user || !startDate || !endDate) return;

    const key = cacheKey(user.uid, userId, startDate, endDate, viewerTimezone);

    // Serve from cache on re-navigation unless caller explicitly requests refresh
    if (!forceRefresh) {
      const cached = getCache<CachedTimesheetData>(key, CACHE_TTL_MS);
      if (cached) {
        setEntries(cached.entries);
        setTimezone(cached.timezone);
        return;
      }
    }

    setLoading(true);
    setError(null);
    try {
      const idToken = await user.getIdToken();
      const params = new URLSearchParams({ startDate, endDate, timezone: viewerTimezone });
      if (userId) params.set('userId', userId);

      const res = await fetch(`/api/time-tracking/entries?${params}`, {
        headers: { Authorization: `Bearer ${idToken}` },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Failed: ${res.status}`);
      }
      const data = await res.json();
      setEntries(data.entries);
      setTimezone(data.timezone || 'UTC');
      setCache<CachedTimesheetData>(key, {
        entries: data.entries,
        timezone: data.timezone || 'UTC',
      });
    } catch (err) {
      console.error('[useTimesheetData] Fetch failed:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [user, userId, startDate, endDate, viewerTimezone]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // refetch() always bypasses the cache so the user can force-refresh
  const refetch = useCallback(() => fetchData(true), [fetchData]);

  return { entries, timezone, loading, error, refetch };
}
