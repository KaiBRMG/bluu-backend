'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { getCache, setCache, invalidateCache } from '@/lib/queryCache';

export interface LeaveRequest {
  leaveId: string;
  shiftId: string;
  occurrenceStart: number;
  userId: string;
  leaveType: 'paid' | 'unpaid';
  status: 'pending' | 'approved' | 'denied';
  requestedAt: string | null;
  resolvedAt: string | null;
  resolvedBy: string | null;
}

interface LeaveRequestsState {
  leaveRequests: LeaveRequest[];
  loading: boolean;
  error: string | null;
}

const CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutes

function cacheKey(uid: string): string {
  return `bluu_leave_requests_v1:${uid}`;
}

export function useLeaveRequests() {
  const { user } = useAuth();
  const [state, setState] = useState<LeaveRequestsState>({
    leaveRequests: [],
    loading: true,
    error: null,
  });

  const fetchData = useCallback(async (forceRefresh = false) => {
    if (!user) {
      setState({ leaveRequests: [], loading: false, error: null });
      return;
    }

    if (!forceRefresh) {
      const cached = getCache<LeaveRequest[]>(cacheKey(user.uid), CACHE_TTL_MS);
      if (cached) {
        setState({ leaveRequests: cached, loading: false, error: null });
        return;
      }
    }

    setState(prev => ({ ...prev, loading: true, error: null }));

    try {
      const idToken = await user.getIdToken();
      const res = await fetch(`/api/shifts/leave?userId=${user.uid}`, {
        headers: { Authorization: `Bearer ${idToken}` },
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? `Request failed: ${res.status}`);
      }

      const data = await res.json();
      const leaveRequests: LeaveRequest[] = data.leaveRequests ?? [];

      setCache(cacheKey(user.uid), leaveRequests);
      setState({ leaveRequests, loading: false, error: null });
    } catch (err) {
      console.error('[useLeaveRequests]', err);
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

  const requestLeave = useCallback(async (
    shiftId: string,
    occurrenceStart: number,
    leaveType: 'paid' | 'unpaid',
  ): Promise<void> => {
    if (!user) throw new Error('Not authenticated');
    const idToken = await user.getIdToken();
    const res = await fetch('/api/shifts/leave', {
      method: 'POST',
      headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ shiftId, occurrenceStart, leaveType }),
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error ?? 'Failed to request leave');
    }
    invalidateCache(cacheKey(user.uid));
    await fetchData(true);
  }, [user, fetchData]);

  const cancelLeave = useCallback(async (leaveId: string): Promise<void> => {
    if (!user) throw new Error('Not authenticated');
    const idToken = await user.getIdToken();
    const res = await fetch(`/api/shifts/leave/${leaveId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${idToken}` },
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error ?? 'Failed to cancel leave');
    }
    invalidateCache(cacheKey(user.uid));
    await fetchData(true);
  }, [user, fetchData]);

  const getLeaveForShift = useCallback((shiftId: string, occurrenceStart: number): LeaveRequest | null => {
    return state.leaveRequests.find(
      lr => lr.shiftId === shiftId && lr.occurrenceStart === occurrenceStart,
    ) ?? null;
  }, [state.leaveRequests]);

  return {
    ...state,
    getLeaveForShift,
    requestLeave,
    cancelLeave,
    refetch: () => fetchData(true),
  };
}
