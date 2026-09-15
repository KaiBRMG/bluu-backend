'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { getCache, setCache, invalidateCache } from '@/lib/queryCache';
import { expandShiftsForWindow, type ExpandedShift, type RawApiShift } from '@/lib/utils/recurrence';
import { monthKeyRange, currentMonthKey } from '@/lib/salary/salaryDate';

/**
 * One month of the signed-in agent's shifts, recurrence already expanded.
 *
 * A calendar has to show the past as well as the future — an agent checking
 * their hours is usually looking at a day that has already happened — so this
 * fetches a whole month rather than a forward window.
 *
 * The window is padded by a day at each end so a shift that starts late on the
 * 31st and runs past midnight still expands into the month it belongs to.
 */

const CACHE_TTL_MS = 2 * 60 * 1000;
const PAD_MS = 24 * 60 * 60 * 1000;

function cacheKey(uid: string, month: string): string {
  return `bluu_shift_calendar_v1:${uid}:${month}`;
}

export function useShiftCalendar(month: string = currentMonthKey()) {
  const { user } = useAuth();
  const [shifts, setShifts] = useState<ExpandedShift[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (force = false) => {
      if (!user) return;

      const key = cacheKey(user.uid, month);
      if (!force) {
        const cached = getCache<ExpandedShift[]>(key, CACHE_TTL_MS);
        if (cached) {
          setShifts(cached);
          setLoading(false);
          setError(null);
          return;
        }
      }

      setLoading(true);
      setError(null);

      try {
        const token = await user.getIdToken();
        const [windowStart, windowEnd] = monthKeyRange(month);
        const params = new URLSearchParams({
          userId: user.uid,
          start: new Date(windowStart - PAD_MS).toISOString(),
          end: new Date(windowEnd + PAD_MS).toISOString(),
        });

        const res = await fetch(`/api/shifts?${params}`, {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (!res.ok) {
          let message = `Could not load shifts (${res.status})`;
          try {
            const body = await res.json();
            if (body?.error) message = body.error;
          } catch {
            /* keep the status-based message */
          }
          throw new Error(message);
        }

        const body = (await res.json()) as { shifts: RawApiShift[] };
        const expanded = expandShiftsForWindow(body.shifts, windowStart - PAD_MS, windowEnd + PAD_MS);

        setCache(key, expanded);
        setShifts(expanded);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not load shifts');
      } finally {
        setLoading(false);
      }
    },
    [user, month],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const refetch = useCallback(async () => {
    if (user) invalidateCache(cacheKey(user.uid, month));
    await load(true);
  }, [user, month, load]);

  return { shifts, loading, error, refetch };
}
