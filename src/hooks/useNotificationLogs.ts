'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { getCache, setCache, invalidateCache } from '@/lib/queryCache';
import type { NotificationLogRow, NotificationLogsResponse } from '@/app/api/admin/notifications/logs/route';

export type { NotificationLogRow };

/** Windows the Logs tab offers, mirroring `ALLOWED_DAYS` on the route. */
export const LOG_RANGE_DAYS = [1, 7, 30, 90, 0] as const;
export type LogRangeDays = (typeof LOG_RANGE_DAYS)[number];

interface NotificationLogsState {
  rows: NotificationLogRow[];
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  nextCursor: string | null;
}

const PAGE_SIZE = 250;
const CACHE_PREFIX = 'bluu_notification_logs_v1';
const CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutes — a delivery log goes stale fast

const cacheKey = (days: LogRangeDays) => `${CACHE_PREFIX}_${days}`;

/**
 * The delivery log behind the Logs tab of `/admin-portal/notifications`.
 *
 * Only the **first** page is cached. Caching an arbitrarily deep "load more"
 * stack would put an unbounded blob in sessionStorage for a surface an admin
 * visits occasionally, and the deeper pages are the cheapest thing to refetch.
 */
export function useNotificationLogs(days: LogRangeDays) {
  const { user } = useAuth();
  const [state, setState] = useState<NotificationLogsState>({
    rows: [],
    loading: true,
    loadingMore: false,
    error: null,
    nextCursor: null,
  });

  // Guards an out-of-order response from a range the user has already left
  // writing itself into state (the same hazard as useAdminData #5).
  const requestSeq = useRef(0);

  const fetchPage = useCallback(
    async (cursor: string | null, forceRefresh: boolean) => {
      if (!user) return;

      const seq = ++requestSeq.current;

      if (!cursor && !forceRefresh) {
        const cached = getCache<NotificationLogsResponse>(cacheKey(days), CACHE_TTL_MS);
        if (cached) {
          setState({
            rows: cached.rows,
            loading: false,
            loadingMore: false,
            error: null,
            nextCursor: cached.nextCursor,
          });
          return;
        }
      }

      setState(prev =>
        cursor
          ? { ...prev, loadingMore: true, error: null }
          : { ...prev, loading: true, error: null },
      );

      try {
        const idToken = await user.getIdToken();
        const params = new URLSearchParams({ days: String(days), limit: String(PAGE_SIZE) });
        if (cursor) params.set('cursor', cursor);

        const res = await fetch(`/api/admin/notifications/logs?${params.toString()}`, {
          headers: { Authorization: `Bearer ${idToken}` },
        });

        if (!res.ok) {
          // Read the status before the body: a non-JSON error page must not
          // replace the real status with a SyntaxError (useAdminData #2).
          let message = `Failed to load logs: ${res.status}`;
          if (res.status === 403) message = 'Access denied';
          else {
            const data = await res.json().catch(() => null);
            if (data?.error) message = data.error;
          }
          throw new Error(message);
        }

        const data = (await res.json()) as NotificationLogsResponse;
        if (seq !== requestSeq.current) return;

        if (!cursor) setCache(cacheKey(days), data);

        setState(prev => ({
          rows: cursor ? [...prev.rows, ...data.rows] : data.rows,
          loading: false,
          loadingMore: false,
          error: null,
          nextCursor: data.nextCursor,
        }));
      } catch (err) {
        if (seq !== requestSeq.current) return;
        setState(prev => ({
          ...prev,
          loading: false,
          loadingMore: false,
          error: err instanceof Error ? err.message : 'Unknown error',
        }));
      }
    },
    [user, days],
  );

  useEffect(() => {
    fetchPage(null, false);
  }, [fetchPage]);

  const loadMore = useCallback(() => {
    if (!state.nextCursor || state.loading || state.loadingMore) return;
    fetchPage(state.nextCursor, true);
  }, [state.nextCursor, state.loading, state.loadingMore, fetchPage]);

  const refetch = useCallback(() => {
    invalidateCache(cacheKey(days));
    return fetchPage(null, true);
  }, [fetchPage, days]);

  return { ...state, loadMore, refetch };
}
