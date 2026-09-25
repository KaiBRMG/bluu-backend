'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import type { LeaveHistoryRow } from '@/app/api/shifts/leave/history/route';

export type { LeaveHistoryRow, LeaveHistoryEvent } from '@/app/api/shifts/leave/history/route';

/**
 * Coverage → History: decided and withdrawn leave, with each request's balance
 * trail.
 *
 * Uncached and fetched on mount only. The History tab unmounts while another
 * tab is showing (Radix `TabsContent`), so coming back to it after deciding a
 * request in the queue is what refreshes it — no polling, no shared store.
 */
export function useLeaveHistory() {
  const { user } = useAuth();
  const [rows, setRows] = useState<LeaveHistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/shifts/leave/history', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        let message = `Could not load leave history (${res.status})`;
        try {
          const body = await res.json();
          if (body?.error) message = body.error;
        } catch {
          /* keep the status-based message */
        }
        throw new Error(message);
      }
      const body = (await res.json()) as { rows: LeaveHistoryRow[] };
      setRows(body.rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load leave history');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  return { rows, loading, error, refetch: load };
}
