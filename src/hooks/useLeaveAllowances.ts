'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuthFetch } from '@/hooks/useAuthFetch';
import { invalidateLeaveRequestsCache } from '@/hooks/useLeaveRequests';
import type { LeaveAllowanceResponse } from '@/app/api/shifts/leave/allowance/route';
import type { LeaveType } from '@/lib/leave/leaveBalance';

export type { LeaveAllowanceRow, LeaveAllowanceResponse } from '@/app/api/shifts/leave/allowance/route';

export interface AllowanceChange {
  uid: string;
  /** A number sets the person's own allotment; `null` or the default returns them to the default. */
  allotment?: { unpaidPerMonth?: number | null; paidPerYear?: number | null };
  /** Sets (not adds) the adjustment for one period; `0` removes it. */
  adjustment?: { type: LeaveType; period: string; days: number; note: string };
}

/**
 * Everyone's leave allowance and what is left of it — or one person's, with
 * `uid`. Admin surfaces only (Shift Management). Not cached: it sits beside the
 * approvals queue whose decisions move it.
 */
export function useLeaveAllowances(uid?: string) {
  const authFetch = useAuthFetch();
  const [data, setData] = useState<LeaveAllowanceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const body = await authFetch(`/api/shifts/leave/allowance${uid ? `?uid=${encodeURIComponent(uid)}` : ''}`);
      setData(body as LeaveAllowanceResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load leave allowances');
    } finally {
      setLoading(false);
    }
  }, [authFetch, uid]);

  useEffect(() => {
    void load();
  }, [load]);

  /** `reload: false` lets a caller saving several people reload once at the end. */
  const save = useCallback(
    async (change: AllowanceChange, { reload = true }: { reload?: boolean } = {}) => {
      await authFetch('/api/shifts/leave/allowance', { method: 'PUT', body: JSON.stringify(change) });
      // The agent's own card reads their requests through this cache; an admin
      // signed in as an agent on the same machine should not see a stale figure.
      invalidateLeaveRequestsCache(change.uid);
      if (reload) await load();
    },
    [authFetch, load],
  );

  return { data, loading, error, reload: load, save };
}
