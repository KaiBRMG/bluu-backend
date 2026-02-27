'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { expandShiftsForWindow } from '@/lib/utils/recurrence';
import type { RawApiShift, ExpandedShift } from '@/lib/utils/recurrence';

interface UserShiftsState {
  shifts: ExpandedShift[];
  loading: boolean;
  error: string | null;
}

/**
 * Fetches the current user's shifts for the next 60 days and expands
 * recurrence rules client-side. Only returns current and future occurrences.
 */
export function useUserShifts() {
  const { user } = useAuth();
  const [state, setState] = useState<UserShiftsState>({
    shifts: [],
    loading: true,
    error: null,
  });

  const fetchData = useCallback(async () => {
    if (!user) return;

    setState(prev => ({ ...prev, loading: true, error: null }));

    try {
      const idToken = await user.getIdToken();

      // Fetch from now to 60 days in the future
      const now    = Date.now();
      const future = now + 60 * 24 * 60 * 60 * 1000;
      const start  = new Date(now).toISOString();
      const end    = new Date(future).toISOString();

      const res = await fetch(
        `/api/shifts?userId=${user.uid}&start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`,
        { headers: { Authorization: `Bearer ${idToken}` } },
      );

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? `Request failed: ${res.status}`);
      }

      const data: { shifts: RawApiShift[] } = await res.json();

      const expanded = expandShiftsForWindow(data.shifts, now, future);

      // Filter to current and future occurrences
      const relevant = expanded.filter(s => s.occurrenceEnd > now);

      setState({ shifts: relevant, loading: false, error: null });
    } catch (err) {
      console.error('[useUserShifts]', err);
      setState(prev => ({
        ...prev,
        loading: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      }));
    }
  }, [user]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return {
    ...state,
    refetch: fetchData,
  };
}
