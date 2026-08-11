'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { getCache, setCache, invalidateCacheByPrefix } from '@/lib/queryCache';
import type { TimesheetSessionPayload } from '@/lib/utils/sessionSegments';

export interface TimesheetEntry {
  id: string;
  /** The ledger session this segment was decomposed from. */
  sessionId: string;
  state: 'working' | 'idle' | 'on-break' | 'paused';
  createdTime: string;
  lastTime: string;
}

/** A whole session, event log included — the source for the walkthrough dialog. */
export type TimesheetSession = TimesheetSessionPayload;

interface CachedTimesheetData {
  entries: TimesheetEntry[];
  sessions: TimesheetSession[];
  timezone: string;
}

interface UseTimesheetDataReturn {
  entries: TimesheetEntry[];
  sessions: TimesheetSession[];
  timezone: string;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

// sessionStorage TTL: 5 minutes. Short enough that active tracking sessions
// see fresh data after re-navigation, long enough to skip the Firestore query
// when the user immediately navigates back to the page.
const CACHE_TTL_MS = 5 * 60 * 1000;

// v2 added `sessions` (raw event logs) to the payload. The version bump is what
// stops a warm v1 entry — segments only — from rendering an empty walkthrough.
function cacheKey(uid: string, userId: string | null, startDate: string, endDate: string, timezone: string): string {
  return `bluu_timesheet_v2:${uid}:${userId ?? 'self'}:${startDate}:${endDate}:${timezone}`;
}

export function invalidateTimesheetCache(uid: string): void {
  invalidateCacheByPrefix(`bluu_timesheet_v2:${uid}:`);
}

/**
 * In-flight requests, keyed by cache key.
 *
 * The sessionStorage cache is only written once a response lands, so two
 * components mounting together and asking for the SAME range both miss it and
 * both query Firestore. The timer page does exactly that — `useDayTotal` and
 * `TodayTimeline` each pull today's ledger via `useTodaySessions`. Sharing the
 * promise makes it one query instead of two (cross-cutting rule 9).
 */
const inFlight = new Map<string, Promise<CachedTimesheetData>>();

export function useTimesheetData(
  userId: string | null,
  startDate: string | null,
  endDate: string | null,
  viewerTimezone = 'UTC',
): UseTimesheetDataReturn {
  const { user } = useAuth();
  const [entries, setEntries] = useState<TimesheetEntry[]>([]);
  const [sessions, setSessions] = useState<TimesheetSession[]>([]);
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
        setSessions(cached.sessions ?? []);
        setTimezone(cached.timezone);
        return;
      }
    }

    setLoading(true);
    setError(null);
    try {
      // Join an identical request already on the wire rather than firing a
      // second one. A forced refresh always starts fresh — it exists precisely
      // to bypass anything already fetched.
      let request = forceRefresh ? undefined : inFlight.get(key);
      if (!request) {
        request = (async () => {
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
          const payload: CachedTimesheetData = {
            entries: data.entries,
            sessions: data.sessions ?? [],
            timezone: data.timezone || 'UTC',
          };
          setCache<CachedTimesheetData>(key, payload);
          return payload;
        })();
        const pending = request;
        inFlight.set(key, pending);
        pending
          .catch(() => {}) // settled purely to clear the entry; the caller still sees the rejection
          .finally(() => { if (inFlight.get(key) === pending) inFlight.delete(key); });
      }

      const payload = await request;
      setEntries(payload.entries);
      setSessions(payload.sessions);
      setTimezone(payload.timezone);
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

  return { entries, sessions, timezone, loading, error, refetch };
}
