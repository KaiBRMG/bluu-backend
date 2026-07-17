'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { getCache, setCache, invalidateCacheByPrefix } from '@/lib/queryCache';
import type {
  DailyPoint,
  AnalyticsTotals,
  AdherenceSummary,
  FocusSummary,
  WellbeingSummary,
  UserSummary,
} from '@/lib/utils/analyticsAggregate';

export type AnalyticsScope = 'user' | 'group' | 'company';

export interface AnalyticsUserRow extends UserSummary {
  displayName: string;
  photoURL: string | null;
}

export interface AnalyticsData {
  range: { start: string; end: string };
  scope: AnalyticsScope;
  entity: { id: string; name: string };
  rosterSize: number;
  series: DailyPoint[];
  totals: AnalyticsTotals;
  byUser: AnalyticsUserRow[];
  heatmap: number[][];
  adherence: AdherenceSummary;
  focus: FocusSummary;
  wellbeing: WellbeingSummary;
  meta: {
    provisionalDays: number;
    daysWithManualEntry: number;
    rollupCount: number;
  };
}

interface UseAnalyticsDataReturn {
  data: AnalyticsData | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

// Rollups only change once a night, so a short TTL is purely about making
// tab-switching and filter-toggling feel instant.
const CACHE_TTL_MS = 5 * 60 * 1000;

function cacheKey(
  uid: string, scope: string, entityId: string | null, start: string, end: string,
): string {
  return `bluu_analytics_v1:${uid}:${scope}:${entityId ?? 'all'}:${start}:${end}`;
}

export function invalidateAnalyticsCache(uid: string): void {
  invalidateCacheByPrefix(`bluu_analytics_v1:${uid}:`);
}

/**
 * Reads the precomputed analytics rollups behind /admin/shift-management →
 * Analytics. Pass `null` for start/end to suppress the fetch (e.g. while the
 * range picker is in an invalid state).
 */
export function useAnalyticsData(
  scope: AnalyticsScope,
  entityId: string | null,
  start: string | null,
  end: string | null,
): UseAnalyticsDataReturn {
  const { user } = useAuth();
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // user/group scope is meaningless without a subject — don't fire a request
  // the server would only 400.
  const needsEntity = scope === 'user' || scope === 'group';
  const ready = Boolean(start && end && (!needsEntity || entityId));

  const fetchData = useCallback(async (forceRefresh = false) => {
    if (!user || !start || !end) return;
    if (needsEntity && !entityId) {
      setData(null);
      return;
    }

    const key = cacheKey(user.uid, scope, entityId, start, end);

    if (!forceRefresh) {
      const cached = getCache<AnalyticsData>(key, CACHE_TTL_MS);
      if (cached) {
        setData(cached);
        setError(null);
        return;
      }
    }

    setLoading(true);
    setError(null);
    try {
      const idToken = await user.getIdToken();
      const params = new URLSearchParams({ scope, start, end });
      if (entityId) params.set('entityId', entityId);

      const res = await fetch(`/api/admin/analytics/timetracking?${params}`, {
        headers: { Authorization: `Bearer ${idToken}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Failed: ${res.status}`);
      }
      const json = await res.json() as AnalyticsData;
      setData(json);
      setCache<AnalyticsData>(key, json);
    } catch (err) {
      console.error('[useAnalyticsData] Fetch failed:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [user, scope, entityId, start, end, needsEntity]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const refetch = useCallback(() => fetchData(true), [fetchData]);

  return { data, loading: loading && ready, error, refetch };
}
