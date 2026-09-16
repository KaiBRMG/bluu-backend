'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { getCache, setCache, invalidateCache } from '@/lib/queryCache';
import { expandShiftsForWindow, type ExpandedShift, type RawApiShift } from '@/lib/utils/recurrence';
import { monthKeyRange, currentMonthKey } from '@/lib/salary/salaryDate';

/**
 * The signed-in agent's shifts for one or more whole months, recurrence already
 * expanded.
 *
 * A calendar has to show the past as well as the future — an agent checking
 * their hours is usually looking at a day that has already happened — so this
 * fetches whole months rather than a forward window.
 *
 * The window is padded by a day at each end so a shift that starts late on the
 * 31st and runs past midnight still expands into the month it belongs to.
 *
 * ## Why months, when the caller may only want a week
 *
 * `ShiftCalendar`'s week view needs seven days, and a week straddling a month
 * boundary needs two of them. Fetching and caching the *month* rather than the
 * requested days is deliberate (CLAUDE.md rule 9): scrolling week by week
 * through September is then one request, not four or five, and the Full Schedule
 * dialog's month view reuses the entry the week view already warmed. The cost is
 * a slightly wider read once, against a saved read on almost every arrow press.
 *
 * The padded windows of two adjacent months overlap, so results are merged on
 * `(shiftId, occurrenceStart)` — the same occurrence must not appear twice.
 */

const CACHE_TTL_MS = 2 * 60 * 1000;
const PAD_MS = 24 * 60 * 60 * 1000;

function cacheKey(uid: string, month: string): string {
  return `bluu_shift_calendar_v1:${uid}:${month}`;
}

function mergeMonths(batches: ExpandedShift[][]): ExpandedShift[] {
  if (batches.length === 1) return batches[0];
  const byOccurrence = new Map<string, ExpandedShift>();
  for (const batch of batches) {
    for (const shift of batch) byOccurrence.set(`${shift.shiftId}:${shift.occurrenceStart}`, shift);
  }
  return [...byOccurrence.values()].sort((a, b) => a.occurrenceStart - b.occurrenceStart);
}

export function useShiftCalendar(months: string | string[] = currentMonthKey()) {
  const { user } = useAuth();
  const [shifts, setShifts] = useState<ExpandedShift[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // A string is the dependency, not the array: a caller computing
  // `[thisMonth, nextMonth]` inline hands us a new array identity every render,
  // which would re-fetch on every parent re-render.
  const monthsKey = useMemo(
    () => [...new Set(Array.isArray(months) ? months : [months])].sort().join(','),
    [months],
  );
  const monthList = useMemo(() => monthsKey.split(','), [monthsKey]);

  const load = useCallback(
    async (force = false) => {
      if (!user) return;

      const cached = monthList.map(month =>
        force ? null : getCache<ExpandedShift[]>(cacheKey(user.uid, month), CACHE_TTL_MS),
      );

      // Every month already warm: no request, and no flash of skeleton on an
      // arrow press back to a week the agent has already looked at.
      if (cached.every(entry => entry !== null)) {
        setShifts(mergeMonths(cached as ExpandedShift[][]));
        setLoading(false);
        setError(null);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const token = await user.getIdToken();

        const batches = await Promise.all(
          monthList.map(async (month, index) => {
            const hit = cached[index];
            if (hit) return hit;

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

            setCache(cacheKey(user.uid, month), expanded);
            return expanded;
          }),
        );

        setShifts(mergeMonths(batches));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not load shifts');
      } finally {
        setLoading(false);
      }
    },
    [user, monthList],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const refetch = useCallback(async () => {
    if (user) for (const month of monthList) invalidateCache(cacheKey(user.uid, month));
    await load(true);
  }, [user, monthList, load]);

  return { shifts, loading, error, refetch };
}
