'use client';

import { useState, useCallback, useMemo } from 'react';
import { useAuthFetch } from '@/hooks/useAuthFetch';
import type { DisputeDocument, ApprovalStatus } from '@/types/firestore';

// ─── Types ────────────────────────────────────────────────────────────

export interface DisputeFetchResult {
  disputes: DisputeDocument[];
  total: number;
  totalPages: number;
}

export interface AdminFilters {
  createdBy?: string;
  assignedTo?: string;
  creator?: string;
}

// ─── Hook ─────────────────────────────────────────────────────────────

/**
 * Dispute reads and verdicts. Filing a dispute is the tip search in
 * `CreateDisputeDialog`, which talks to its own two routes; the creator and
 * CA-user pickers the old freeform form needed are gone with it.
 */
export function useDisputesData() {
  const authFetch = useAuthFetch();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Fetch disputes (not cached — always fresh) ─────────────────────

  const fetchDisputes = useCallback(async (
    filter: string,
    page: number,
    adminFilters?: AdminFilters,
  ): Promise<DisputeFetchResult> => {
    const params = new URLSearchParams({ filter, page: String(page) });
    if (adminFilters?.createdBy) params.set('createdBy', adminFilters.createdBy);
    if (adminFilters?.assignedTo) params.set('assignedTo', adminFilters.assignedTo);
    if (adminFilters?.creator) params.set('creator', adminFilters.creator);

    const data = await authFetch(`/api/disputes?${params}`);
    return { disputes: data.disputes, total: data.total, totalPages: data.totalPages };
  }, [authFetch]);

  // ── Set CA approval ─────────────────────────────────────────────────

  const setCaApproval = useCallback(async (
    disputeId: string,
    value: Extract<ApprovalStatus, 'Approved' | 'Rejected'>,
    reason?: string,
  ): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      await authFetch(`/api/disputes/${disputeId}/ca-approval`, {
        method: 'PATCH',
        body: JSON.stringify({ CaApproval: value, reason }),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to update CA approval';
      setError(msg);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [authFetch]);

  // ── Set admin approval ──────────────────────────────────────────────

  const setAdminApproval = useCallback(async (
    disputeId: string,
    value: Extract<ApprovalStatus, 'Approved' | 'Rejected'>,
    reason?: string,
  ): Promise<{ transferResult: DisputeDocument['transferResult'] }> => {
    setLoading(true);
    setError(null);
    try {
      const data = await authFetch(`/api/disputes/${disputeId}/admin-approval`, {
        method: 'PATCH',
        body: JSON.stringify({ AdminApproval: value, reason }),
      });
      return { transferResult: data.transferResult ?? null };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to update admin approval';
      setError(msg);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [authFetch]);

  // ── Set admin approval on many disputes at once ─────────────────────
  //
  // One request for a whole selection, not one per row: the server writes them
  // in a batch and queues a single notification per filer. Returns how many
  // rows the server actually wrote, because a stale selection can legitimately
  // contain a dispute that no longer exists.

  const setAdminApprovalBulk = useCallback(async (
    disputeIds: string[],
    value: Extract<ApprovalStatus, 'Approved' | 'Rejected'>,
    reason?: string,
  ): Promise<{ updated: number; skipped: number; transferred: number; transferSkipped: number }> => {
    setLoading(true);
    setError(null);
    try {
      const data = await authFetch('/api/disputes/bulk-approval', {
        method: 'PATCH',
        body: JSON.stringify({ disputeIds, AdminApproval: value, reason }),
      });
      return {
        updated: data.updated ?? disputeIds.length,
        skipped: data.skipped ?? 0,
        transferred: data.transferred ?? 0,
        transferSkipped: data.transferSkipped ?? 0,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to update disputes';
      setError(msg);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [authFetch]);

  return useMemo(() => ({
    loading,
    error,
    fetchDisputes,
    setCaApproval,
    setAdminApproval,
    setAdminApprovalBulk,
  }), [loading, error, fetchDisputes, setCaApproval, setAdminApproval, setAdminApprovalBulk]);
}
