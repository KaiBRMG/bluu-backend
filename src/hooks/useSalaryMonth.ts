'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { getCache, setCache, invalidateCache } from '@/lib/queryCache';
import { currentMonthKey } from '@/lib/salary/salaryDate';
import type { SalaryMonthResult } from '@/lib/salary/salaryTypes';

/**
 * One agent's salary month.
 *
 * Serves the agent's own dashboard and the admin drill-down from the same
 * endpoint, so `userId` is optional: absent means "mine", which is also what the
 * server assumes. The cache is keyed by both, because an admin flicking between
 * agents must never see the previous one's figures for a frame.
 *
 * The 60s TTL is deliberately short for cached data in this app: an admin who
 * has just edited a cell expects the next page to agree with them, and a salary
 * figure that is quietly two minutes stale is the kind of thing that gets
 * screenshotted into a dispute.
 */

const CACHE_TTL_MS = 60 * 1000;

function cacheKey(viewerUid: string, subjectUid: string, month: string): string {
  return `bluu_salary_month_v1:${viewerUid}:${subjectUid}:${month}`;
}

export interface SalaryMonthWithUser extends SalaryMonthResult {
  user: { uid: string; displayName: string; photoURL: string | null } | null;
}

export function useSalaryMonth(month?: string, userId?: string | null) {
  const { user } = useAuth();
  const activeMonth = month ?? currentMonthKey();

  const [data, setData] = useState<SalaryMonthWithUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchMonth = useCallback(
    async (force = false) => {
      if (!user) {
        setLoading(false);
        return;
      }

      const subject = userId ?? user.uid;
      const key = cacheKey(user.uid, subject, activeMonth);

      if (!force) {
        const cached = getCache<SalaryMonthWithUser>(key, CACHE_TTL_MS);
        if (cached) {
          setData(cached);
          setLoading(false);
          setError(null);
          return;
        }
      }

      setLoading(true);
      setError(null);

      try {
        const token = await user.getIdToken();
        const params = new URLSearchParams({ month: activeMonth });
        if (userId && userId !== user.uid) params.set('userId', userId);

        const res = await fetch(`/api/ca-salary/month?${params}`, {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (!res.ok) {
          // Parse defensively: a proxy timeout or an HTML error page would
          // otherwise throw a SyntaxError that replaces the real status.
          let message = `Could not load salary (${res.status})`;
          try {
            const body = await res.json();
            if (body?.error) message = body.error;
          } catch {
            /* keep the status-based message */
          }
          throw new Error(message);
        }

        const body = (await res.json()) as SalaryMonthWithUser;
        setCache(key, body);
        setData(body);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not load salary');
      } finally {
        setLoading(false);
      }
    },
    [user, activeMonth, userId],
  );

  useEffect(() => {
    fetchMonth();
  }, [fetchMonth]);

  const refetch = useCallback(async () => {
    if (user) invalidateCache(cacheKey(user.uid, userId ?? user.uid, activeMonth));
    await fetchMonth(true);
  }, [user, userId, activeMonth, fetchMonth]);

  /**
   * Apply a server-computed month straight into state.
   *
   * The override endpoints return the recomputed month, so an edit lands without
   * a second round trip — and, more importantly, without the client trying to
   * reproduce arithmetic that can re-tier every later day in the month.
   */
  const applyServerMonth = useCallback(
    (next: SalaryMonthResult) => {
      if (!user) return;
      const merged = { ...next, user: data?.user ?? null } as SalaryMonthWithUser;
      setCache(cacheKey(user.uid, userId ?? user.uid, activeMonth), merged);
      setData(merged);
    },
    [user, userId, activeMonth, data?.user],
  );

  return { data, loading, error, refetch, applyServerMonth };
}
