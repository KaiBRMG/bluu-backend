'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { expandShiftsForWindow } from '@/lib/utils/recurrence';
import type { RawApiShift, ExpandedShift } from '@/lib/utils/recurrence';
import { getCache, setCache, invalidateCache } from '@/lib/queryCache';

export interface ShiftUser {
  uid: string;
  displayName: string;
  photoURL: string | null;
  timezone: string;
  includeIdleTime: boolean;
  groups: string[];
  timeTracking: boolean;
}

export interface CreateShiftPayload {
  userId: string;
  startTime: string;        // ISO
  endTime: string;          // ISO
  wallClockStart: string;   // "HH:mm"
  wallClockEnd: string;     // "HH:mm"
  userTimezone: string;
  recurrence: object | null;
}

export interface UpdateShiftPayload extends Partial<CreateShiftPayload> {
  saveMode?: 'single' | 'future';
  overrideDate?: string;    // ISO — required when saveMode is 'single' or 'future'
}

interface ShiftsState {
  shifts: ExpandedShift[];
  users: ShiftUser[];
  loading: boolean;
  error: string | null;
}

interface ShiftsCacheData {
  shifts: ExpandedShift[];
  users: ShiftUser[];
}

const CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutes

function cacheKey(weekStart: string): string {
  return `bluu_shifts_week_v1:${weekStart}`;
}

/** Compute the Monday of the week that contains `dateStr` (YYYY-MM-DD). */
export function getMondayOfWeek(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = dt.getUTCDay(); // 0=Sun
  const mondayOffset = (dow + 6) % 7;
  const monday = new Date(dt.getTime() - mondayOffset * 86_400_000);
  return monday.toISOString().slice(0, 10);
}

/** Today's date as YYYY-MM-DD. */
export function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

export function useShifts(weekStart: string) {
  const { user } = useAuth();
  const [state, setState] = useState<ShiftsState>(() => {
    const cached = getCache<ShiftsCacheData>(cacheKey(weekStart), CACHE_TTL_MS);
    if (cached) {
      return { shifts: cached.shifts, users: cached.users, loading: false, error: null };
    }
    return { shifts: [], users: [], loading: true, error: null };
  });

  // When weekStart changes, sync state from cache (or reset to loading)
  // before the fetch effect runs to avoid flashing stale week data.
  useEffect(() => {
    const cached = getCache<ShiftsCacheData>(cacheKey(weekStart), CACHE_TTL_MS);
    if (cached) {
      setState({ shifts: cached.shifts, users: cached.users, loading: false, error: null });
    } else {
      setState({ shifts: [], users: [], loading: true, error: null });
    }
  }, [weekStart]);

  const fetchData = useCallback(async (forceRefresh = false) => {
    if (!user || !weekStart) return;

    if (!forceRefresh) {
      const cached = getCache<ShiftsCacheData>(cacheKey(weekStart), CACHE_TTL_MS);
      if (cached) {
        setState({ shifts: cached.shifts, users: cached.users, loading: false, error: null });
        return;
      }
    }

    setState(prev => ({ ...prev, loading: true, error: null }));

    try {
      const idToken = await user.getIdToken();
      const res = await fetch(`/api/shifts/week?weekStart=${weekStart}`, {
        headers: { Authorization: `Bearer ${idToken}` },
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? `Request failed: ${res.status}`);
      }

      const data: { shifts: RawApiShift[]; users: ShiftUser[] } = await res.json();

      // Compute window bounds for expansion
      const [wy, wm, wd] = weekStart.split('-').map(Number);
      const windowStartMs = Date.UTC(wy, wm - 1, wd, 0, 0, 0, 0);
      const windowEndMs   = Date.UTC(wy, wm - 1, wd + 6, 23, 59, 59, 999);

      const expanded = expandShiftsForWindow(data.shifts, windowStartMs, windowEndMs);

      setCache<ShiftsCacheData>(cacheKey(weekStart), { shifts: expanded, users: data.users });
      setState({ shifts: expanded, users: data.users, loading: false, error: null });
    } catch (err) {
      console.error('[useShifts]', err);
      setState(prev => ({
        ...prev,
        loading: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      }));
    }
  }, [user, weekStart]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // ── Mutations ────────────────────────────────────────────────────────

  const createShift = useCallback(async (payload: CreateShiftPayload) => {
    if (!user) throw new Error('Not authenticated');
    const idToken = await user.getIdToken();

    const res = await fetch('/api/shifts', {
      method: 'POST',
      headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error ?? 'Failed to create shift');
    }

    invalidateCache(cacheKey(weekStart));
    await fetchData(true);
  }, [user, weekStart, fetchData]);

  const updateShift = useCallback(async (shiftId: string, payload: UpdateShiftPayload) => {
    if (!user) throw new Error('Not authenticated');
    const idToken = await user.getIdToken();

    const res = await fetch(`/api/shifts/${shiftId}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error ?? 'Failed to update shift');
    }

    invalidateCache(cacheKey(weekStart));
    await fetchData(true);
  }, [user, weekStart, fetchData]);

  const deleteShift = useCallback(async (
    shiftId: string,
    mode: 'single' | 'future' | 'series',
    overrideDate?: string,
  ) => {
    if (!user) throw new Error('Not authenticated');
    const idToken = await user.getIdToken();

    const params = new URLSearchParams({ mode });
    if (overrideDate) params.set('overrideDate', overrideDate);

    const res = await fetch(`/api/shifts/${shiftId}?${params}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${idToken}` },
    });

    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error ?? 'Failed to delete shift');
    }

    invalidateCache(cacheKey(weekStart));
    await fetchData(true);
  }, [user, weekStart, fetchData]);

  return {
    ...state,
    refetch: () => fetchData(true),
    createShift,
    updateShift,
    deleteShift,
  };
}
