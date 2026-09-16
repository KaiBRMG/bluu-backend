'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { invalidateShiftCalendarCache } from './useShiftCalendar';
import { invalidateLeaveRequestsCache } from './useLeaveRequests';

/**
 * The admin leave-approval queue — every agent's requests, soonest shift first.
 *
 * Uncached, like the coverage board and for the same reason: this is a decision
 * queue two admins may be working at once, and a stale row is one that gets
 * approved twice. It is a single indexed query.
 */

export interface AdminLeaveRow {
  leaveId: string;
  shiftId: string;
  occurrenceStart: number;
  userId: string;
  leaveType: 'paid' | 'unpaid';
  status: 'pending' | 'approved' | 'denied';
  requestedAt: string | null;
  resolvedAt: string | null;
  resolvedBy: string | null;
  reason: string | null;
  displayName: string | null;
  photoURL: string | null;
}

export interface LeaveDecisionResult {
  offersCreated: number;
  creatorNames: string[];
  noAssignments: boolean;
  occurrenceRemoved: boolean;
}

export function useAdminLeaveQueue(status: 'pending' | 'approved' | 'denied' | 'all' = 'pending') {
  const { user } = useAuth();
  const [rows, setRows] = useState<AdminLeaveRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);

    try {
      const token = await user.getIdToken();
      const params = new URLSearchParams({ scope: 'all' });
      if (status !== 'all') params.set('status', status);

      const res = await fetch(`/api/shifts/leave?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        let message = `Could not load leave requests (${res.status})`;
        try {
          const body = await res.json();
          if (body?.error) message = body.error;
        } catch {
          /* keep the status-based message */
        }
        throw new Error(message);
      }

      const body = (await res.json()) as { leaveRequests: AdminLeaveRow[] };
      setRows(body.leaveRequests);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load leave requests');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [user, status]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Approve or deny, returning what the approval *released*.
   *
   * The coverage report comes back rather than being swallowed, because
   * "approved, but that shift had no accounts assigned so nothing was posted for
   * cover" is a materially different outcome from a clean approval — and the one
   * an admin needs to act on.
   */
  const decide = useCallback(
    async (leaveId: string, action: 'approve' | 'deny'): Promise<LeaveDecisionResult | null> => {
      if (!user) throw new Error('Not signed in');

      const token = await user.getIdToken();
      const res = await fetch(`/api/shifts/leave/${leaveId}/approve`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });

      if (!res.ok) {
        let message = `Could not ${action} this request (${res.status})`;
        try {
          const body = await res.json();
          if (body?.error) message = body.error;
        } catch {
          /* keep the status-based message */
        }
        throw new Error(message);
      }

      const body = (await res.json()) as { coverage?: LeaveDecisionResult | null };

      // Approving releases the occurrence — the agent's roster just changed, and
      // the dashboard caches that answer for two minutes under a key this hook
      // has no other reason to know about. Without this the shift stayed on the
      // calendar while the accounts it released appeared on the overtime board
      // immediately (that board caches nothing), which reads as the release
      // half-working rather than as a stale read.
      //
      // Only the acting admin's own tab is reachable — `sessionStorage` is
      // per-renderer — so this is what fixes approving your *own* leave. Another
      // agent's dashboard picks the change up on its next focus revalidation.
      const target = rows.find(row => row.leaveId === leaveId)?.userId;
      if (target) {
        invalidateShiftCalendarCache(target);
        invalidateLeaveRequestsCache(target);
      }

      await load();
      return body.coverage ?? null;
    },
    [user, load, rows],
  );

  return { rows, loading, error, refetch: load, decide };
}
