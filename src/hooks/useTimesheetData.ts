'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/components/AuthProvider';
import type { TimeEntryState } from '@/types/firestore';

export interface TimesheetEntry {
  id: string;
  state: TimeEntryState;
  createdTime: string;
  lastTime: string;
}

interface CachedTimesheetData {
  entries: TimesheetEntry[];
  timezone: string;
  includeIdleTime: boolean;
  cachedAt: number;
}

interface UseTimesheetDataReturn {
  entries: TimesheetEntry[];
  timezone: string;
  includeIdleTime: boolean;
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

function readCache(key: string): CachedTimesheetData | null {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedTimesheetData;
    if (Date.now() - parsed.cachedAt > CACHE_TTL_MS) {
      sessionStorage.removeItem(key);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(key: string, data: Omit<CachedTimesheetData, 'cachedAt'>): void {
  try {
    sessionStorage.setItem(key, JSON.stringify({ ...data, cachedAt: Date.now() }));
  } catch {
    // sessionStorage may be full; non-fatal
  }
}

export function invalidateTimesheetCache(uid: string): void {
  try {
    const prefix = `bluu_timesheet_v1:${uid}:`;
    const toRemove: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k && k.startsWith(prefix)) toRemove.push(k);
    }
    for (const k of toRemove) sessionStorage.removeItem(k);
  } catch {
    // ignore
  }
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
  const [includeIdleTime, setIncludeIdleTime] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async (forceRefresh = false) => {
    if (!user || !startDate || !endDate) return;

    const key = cacheKey(user.uid, userId, startDate, endDate, viewerTimezone);

    // Serve from cache on re-navigation unless caller explicitly requests refresh
    if (!forceRefresh) {
      const cached = readCache(key);
      if (cached) {
        setEntries(cached.entries);
        setTimezone(cached.timezone);
        setIncludeIdleTime(cached.includeIdleTime);
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
      setIncludeIdleTime(data.includeIdleTime ?? false);
      writeCache(key, {
        entries: data.entries,
        timezone: data.timezone || 'UTC',
        includeIdleTime: data.includeIdleTime ?? false,
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

  return { entries, timezone, includeIdleTime, loading, error, refetch };
}
