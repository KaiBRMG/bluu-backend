'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { getCache, setCache, invalidateCacheByPrefix } from '@/lib/queryCache';
import { invalidateShiftsWeekCache } from '@/hooks/useShifts';
import { invalidateShiftCalendarCache } from '@/hooks/useShiftCalendar';
import type { ExpandedShift } from '@/lib/utils/recurrence';
import type { ShiftUser, CreateShiftPayload, UpdateShiftPayload } from '@/hooks/useShifts';

/**
 * CA Portal → Shift Calendar data: one week of shifts from
 * `/api/ca-shift-calendar`, plus the shift write routes for editors.
 *
 * A reader (agent) receives a projection — window, agent and accounts only. An
 * editor (`shift-management`) receives full occurrences, attendance and leave,
 * and every eligible agent, so the shared `ShiftModal` can edit from here. Both
 * shapes satisfy {@link CalendarShift}; the extra fields are simply absent for
 * a reader.
 */

export interface CalendarShift {
  shiftId: string;
  userId: string;
  occurrenceStart: number;
  occurrenceEnd: number;
  creatorIds?: string[];
  overtimeCreatorIds?: string[];
  isOvertime?: boolean;
  paysWage?: boolean;
  // Editor-only
  attendanceStatus?: ExpandedShift['attendanceStatus'];
  leaveRequest?: ExpandedShift['leaveRequest'];
}

export interface CalendarPerson {
  uid: string;
  displayName: string;
  photoURL: string | null;
}

interface CalendarData {
  canEdit: boolean;
  shifts: CalendarShift[];
  /** Readers: agents on shift this week. Editors: every eligible agent (`ShiftUser`). */
  users: CalendarPerson[] | ShiftUser[];
}

const EMPTY_SHIFTS: CalendarShift[] = [];
const EMPTY_USERS: CalendarPerson[] = [];
const CACHE_PREFIX = 'bluu_ca_shift_calendar_v1:';
const TTL_MS = 60 * 1000;

const cacheKey = (uid: string, weekStart: string) => `${CACHE_PREFIX}${uid}:${weekStart}`;

/** Drop every cached Shift Calendar week — called by any shift write elsewhere. */
export function invalidateCaShiftCalendarCache(): void {
  invalidateCacheByPrefix(CACHE_PREFIX);
}

async function readError(res: Response, fallback: string): Promise<string> {
  try {
    const body = await res.json();
    if (typeof body?.error === 'string') return body.error;
  } catch {
    /* non-JSON error body — keep the status */
  }
  return `${fallback} (${res.status})`;
}

export function useCaShiftCalendar(weekStart: string) {
  const { user } = useAuth();
  const uid = user?.uid ?? '';
  const key = uid ? cacheKey(uid, weekStart) : '';
  // What the network last answered, tagged with the week it answered for — so a
  // response for a week the reader has left can never render under the new
  // week's header, and nothing has to be reset in an effect.
  const [fetched, setFetched] = useState<{ key: string; data: CalendarData } | null>(null);
  const [failed, setFailed] = useState<{ key: string; message: string } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const latest = useRef(0);

  // Read per key, not per response: once `fetched` matches the key it supersedes this.
  const cached = useMemo(() => (key ? getCache<CalendarData>(key, TTL_MS) : null), [key]);
  const data = fetched?.key === key ? fetched.data : cached;
  const error = failed?.key === key ? failed.message : null;
  const loading = refreshing || (data === null && !error && !!key);

  const fetchWeek = useCallback(async (force = false) => {
    if (!user || !key) return;
    if (!force && getCache<CalendarData>(key, TTL_MS)) return;

    const seq = ++latest.current;
    try {
      const token = await user.getIdToken();
      const res = await fetch(`/api/ca-shift-calendar?weekStart=${weekStart}`, {
        headers: { Authorization: `Bearer ${token}` },
        // A forced refresh must skip the browser's `max-age` copy too.
        cache: force ? 'no-store' : 'default',
      });
      if (!res.ok) throw new Error(await readError(res, 'Could not load the shift calendar'));
      const body = (await res.json()) as CalendarData;
      if (seq !== latest.current) return;
      setCache(key, body);
      setFetched({ key, data: body });
      setFailed(null);
    } catch (err) {
      if (seq !== latest.current) return;
      console.error('[useCaShiftCalendar]', err);
      setFailed({ key, message: err instanceof Error ? err.message : 'Could not load the shift calendar' });
    }
  }, [user, key, weekStart]);

  // The spinner belongs to the refresh button, set from its handler — not from
  // `fetchWeek`, which an effect calls (a setState there cascades a render).
  const refetch = useCallback(async () => {
    setRefreshing(true);
    try {
      await fetchWeek(true);
    } finally {
      setRefreshing(false);
    }
  }, [fetchWeek]);

  useEffect(() => {
    // Every setState inside `fetchWeek` runs after an `await` (a network
    // response), never synchronously in this effect body.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchWeek();
  }, [fetchWeek]);

  // ── Writes (editors only; the routes enforce `shift-management`) ────────
  const afterWrite = useCallback(async (affectedUserIds: string[]) => {
    invalidateCaShiftCalendarCache();
    invalidateShiftsWeekCache();
    for (const id of affectedUserIds) invalidateShiftCalendarCache(id);
    await fetchWeek(true);
  }, [fetchWeek]);

  const send = useCallback(async (url: string, init: RequestInit, fallback: string) => {
    if (!user) throw new Error('Not signed in');
    const token = await user.getIdToken();
    const res = await fetch(url, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    });
    if (!res.ok) throw new Error(await readError(res, fallback));
  }, [user]);

  const createShift = useCallback(async (payload: CreateShiftPayload) => {
    await send('/api/shifts', { method: 'POST', body: JSON.stringify(payload) }, 'Could not create the shift');
    await afterWrite([payload.userId]);
  }, [send, afterWrite]);

  const updateShift = useCallback(async (shiftId: string, payload: UpdateShiftPayload, ownerId: string) => {
    await send(`/api/shifts/${shiftId}`, { method: 'PUT', body: JSON.stringify(payload) }, 'Could not update the shift');
    await afterWrite([ownerId, ...(payload.userId && payload.userId !== ownerId ? [payload.userId] : [])]);
  }, [send, afterWrite]);

  const deleteShift = useCallback(async (
    shiftId: string,
    mode: 'single' | 'future' | 'series',
    ownerId: string,
    overrideDate?: string,
  ) => {
    const params = new URLSearchParams({ mode });
    if (overrideDate) params.set('overrideDate', overrideDate);
    await send(`/api/shifts/${shiftId}?${params}`, { method: 'DELETE' }, 'Could not delete the shift');
    await afterWrite([ownerId]);
  }, [send, afterWrite]);

  return useMemo(() => ({
    canEdit: data?.canEdit ?? false,
    shifts: data?.shifts ?? EMPTY_SHIFTS,
    users: data?.users ?? EMPTY_USERS,
    loading,
    error,
    refetch,
    createShift,
    updateShift,
    deleteShift,
  }), [data, loading, error, refetch, createShift, updateShift, deleteShift]);
}
