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

/** CA Admin → Sales' "Moved by dispute" feed: the newest rows, and the window's total. */
export interface MovedFeedResult {
  disputes: DisputeDocument[];
  total: number;
  windowDays: number;
}

type TransferResult = DisputeDocument['transferResult'];

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

  const fetchDisputes = useCallback(async (filter: string, page = 1): Promise<DisputeFetchResult> => {
    const params = new URLSearchParams({ filter, page: String(page) });
    const data = await authFetch(`/api/disputes?${params}`);
    return { disputes: data.disputes, total: data.total, totalPages: data.totalPages };
  }, [authFetch]);

  /** The newest disputes approved inside the server's window (`ca-admin`). */
  const fetchMoved = useCallback(async (): Promise<MovedFeedResult> => {
    const data = await authFetch('/api/disputes?filter=admin-moved');
    return { disputes: data.disputes, total: data.total, windowDays: data.windowDays };
  }, [authFetch]);

  /** One claim, on demand — opened from a ledger row (`ca-admin`). */
  const fetchDispute = useCallback(async (disputeId: string): Promise<DisputeDocument> => {
    const data = await authFetch(`/api/disputes/${encodeURIComponent(disputeId)}`);
    return data.dispute;
  }, [authFetch]);

  // ── Set CA approval ─────────────────────────────────────────────────

  const setCaApproval = useCallback(async (
    disputeId: string,
    value: Extract<ApprovalStatus, 'Approved' | 'Rejected'>,
    reason?: string,
  ): Promise<{ transferResult: TransferResult }> => {
    setLoading(true);
    setError(null);
    try {
      // The holder's approval is final: it moves the sales, and says what moved.
      const data = await authFetch(`/api/disputes/${disputeId}/ca-approval`, {
        method: 'PATCH',
        body: JSON.stringify({ CaApproval: value, reason }),
      });
      return { transferResult: data.transferResult ?? null };
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
  ): Promise<{ transferResult: TransferResult }> => {
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

  return useMemo(() => ({
    loading,
    error,
    fetchDisputes,
    fetchMoved,
    fetchDispute,
    setCaApproval,
    setAdminApproval,
  }), [loading, error, fetchDisputes, fetchMoved, fetchDispute, setCaApproval, setAdminApproval]);
}
