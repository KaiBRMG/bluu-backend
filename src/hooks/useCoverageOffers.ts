'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { addDays, currentDayKey } from '@/lib/salary/salaryDate';

/**
 * The overtime board.
 *
 * Uncached on purpose, unlike almost every other read in this app. Overtime is
 * first-come: a two-minute-stale board shows accounts that are already gone and
 * hides ones that just appeared, and an agent who claims a vanished shift learns
 * to distrust the whole screen. It is one small query.
 */

export interface CoverageOfferRow {
  offerId: string;
  day: string;
  creatorId: string;
  creatorName: string;
  originalUserId: string;
  originalUserName: string | null;
  originalShiftId: string;
  windowStart: number;
  windowEnd: number;
  status: 'available' | 'assigned' | 'cancelled';
  claimCount: number;
  myClaim: { userId: string; claimedAt: string; note?: string } | null;
  claims?: Array<{ userId: string; displayName: string; claimedAt: string; note?: string }>;
  assignedTo: string | null;
  assignedToName: string | null;
  assignedInShift: boolean;
  leaveId: string | null;
}

/**
 * An absence that was cancelled after it had already been approved. Admin-only,
 * and empty for everyone else — the offers it created are deleted by the
 * revert, so this is the only record that they existed.
 */
export interface CoverageWithdrawalRow {
  leaveId: string;
  userId: string;
  displayName: string;
  day: string;
  leaveType: 'paid' | 'unpaid';
  creatorNames: string[];
  reverted: Array<{ userId: string; displayName: string; creatorNames: string[] }>;
  shiftRestored: boolean;
  withdrawnAt: string | null;
}

interface CoverageState {
  offers: CoverageOfferRow[];
  withdrawals: CoverageWithdrawalRow[];
  isAdmin: boolean;
  loading: boolean;
  error: string | null;
}

export function useCoverageOffers(
  options: { from?: string; to?: string; status?: string; enabled?: boolean } = {},
) {
  const { user } = useAuth();
  // Callers that render the board conditionally still have to call the hook, so
  // the opt-out lives here rather than at the call site.
  const enabled = options.enabled ?? true;
  const from = options.from ?? addDays(currentDayKey(), -1);
  const to = options.to ?? addDays(currentDayKey(), 45);
  const status = options.status;

  const [state, setState] = useState<CoverageState>({
    offers: [],
    withdrawals: [],
    isAdmin: false,
    loading: enabled,
    error: null,
  });

  const load = useCallback(async () => {
    if (!user || !enabled) return;
    setState(prev => ({ ...prev, loading: true, error: null }));

    try {
      const token = await user.getIdToken();
      const params = new URLSearchParams({ from, to });
      if (status) params.set('status', status);

      const res = await fetch(`/api/ca-coverage/offers?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        let message = `Could not load available shifts (${res.status})`;
        try {
          const body = await res.json();
          if (body?.error) message = body.error;
        } catch {
          /* keep the status-based message */
        }
        throw new Error(message);
      }

      const body = (await res.json()) as {
        offers: CoverageOfferRow[];
        withdrawals?: CoverageWithdrawalRow[];
        isAdmin: boolean;
      };
      setState({
        offers: body.offers,
        withdrawals: body.withdrawals ?? [],
        isAdmin: body.isAdmin,
        loading: false,
        error: null,
      });
    } catch (err) {
      setState(prev => ({
        ...prev,
        loading: false,
        error: err instanceof Error ? err.message : 'Could not load available shifts',
      }));
    }
  }, [user, from, to, status, enabled]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Claim or withdraw. Rejects with the server's own message so the caller can
   * show it — "that would put you on 6 accounts" is the whole point of the
   * response and a generic failure toast would throw it away.
   */
  const setClaim = useCallback(
    async (offerId: string, claimed: boolean) => {
      if (!user) throw new Error('Not signed in');
      const token = await user.getIdToken();

      const res = claimed
        ? await fetch('/api/ca-coverage/claim', {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ offerId }),
          })
        : await fetch(`/api/ca-coverage/claim?offerId=${encodeURIComponent(offerId)}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${token}` },
          });

      if (!res.ok) {
        let message = `Could not update your claim (${res.status})`;
        try {
          const body = await res.json();
          if (body?.error) message = body.error;
        } catch {
          /* keep the status-based message */
        }
        throw new Error(message);
      }

      await load();
    },
    [user, load],
  );

  return { ...state, refetch: load, setClaim };
}
