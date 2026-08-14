'use client';

import { useCallback, useMemo } from 'react';
import { useAuthFetch } from '@/hooks/useAuthFetch';
import { getCache, invalidateCacheByPrefix, setCache } from '@/lib/queryCache';
import type { SmmBonusRound, SmmNetwork, SmmSubmission, ViralLinkReport } from '@/types/firestore';

export interface UserTotalRow {
  uid: string;
  displayName: string;
  photoURL?: string | null;
  total: number;
}

export interface CurrentRoundMe {
  round: SmmBonusRound | null;
  submissions: SmmSubmission[];
  myTotal: number;
}

export interface CurrentRoundAll {
  round: SmmBonusRound | null;
  submissions: SmmSubmission[];
  userTotals: UserTotalRow[];
  rounds: SmmBonusRound[]; // every round, newest first — the admin round picker
}

export interface PreviousRound {
  round: SmmBonusRound;
  submissions: SmmSubmission[];
  userTotals: UserTotalRow[];
}

export interface EligibilityResult {
  found: boolean;
  eligible: boolean;
  source?: 'post' | 'submission';
  daysDiff?: number | null;
  detail?: { link: string; userName: string; date: string | null };
  /** The handle parsed out of the link ('' when it isn't a profile/post URL). */
  handle: string;
  /**
   * The account that handle resolves to in `twitterx-accounts` — the copy's
   * origin AND the post's "uploaded from" source (its network pays the network
   * bonus). null when the handle isn't in the database, which blocks the copy.
   * A resolved account with `isViralBonus: false` blocks it too — it is not a
   * page SMMs may copy from.
   */
  account: { id: string; name: string; network: SmmNetwork; isViralBonus: boolean } | null;
  /** Every record found for the pasted link — the result card's full report. */
  report: ViralLinkReport;
}

export interface SubmitBonusPayload {
  accountId: string;
  postId: string;
  numLikes: number;
  screenshotLink?: string;
  // The viral-copy declaration is NOT sent — it lives on the post, captured
  // and verified when the post was scheduled.
}

export interface SubmitBonusResult {
  bonusAmount: number;
  status: string;
  sysComments: string;
  suggestionShareCreated: boolean;
}

const CACHE_PREFIX = 'bluu_smm_bonus_';
const CACHE_TTL_MS = 5 * 60 * 1000;
const meKey = 'bluu_smm_bonus_current_me_v1';
const allKey = 'bluu_smm_bonus_current_all_v1';

/** twitterx-bonus access — current round (cached), previous rounds (lazy), mutations. */
export function useSmmBonus() {
  const authFetch = useAuthFetch();

  const invalidate = useCallback(() => invalidateCacheByPrefix(CACHE_PREFIX), []);

  const fetchCurrentMe = useCallback(async (force = false): Promise<CurrentRoundMe> => {
    if (!force) {
      const cached = getCache<CurrentRoundMe>(meKey, CACHE_TTL_MS);
      if (cached) return cached;
    }
    const data = await authFetch('/api/smm/bonus/current?scope=me');
    setCache(meKey, data);
    return data;
  }, [authFetch]);

  /**
   * The admin round view. Only the default (current) round is cached — an
   * explicitly picked round is a deliberate one-off lookup, and caching every
   * round the admin browses would just stale the picker.
   */
  const fetchCurrentAll = useCallback(async (force = false, roundId?: string): Promise<CurrentRoundAll> => {
    if (roundId) {
      return authFetch(`/api/smm/bonus/current?scope=all&roundId=${encodeURIComponent(roundId)}`);
    }
    if (!force) {
      const cached = getCache<CurrentRoundAll>(allKey, CACHE_TTL_MS);
      if (cached) return cached;
    }
    const data = await authFetch('/api/smm/bonus/current?scope=all');
    setCache(allKey, data);
    return data;
  }, [authFetch]);

  const fetchPreviousRounds = useCallback(async (
    scope: 'me' | 'all',
    page: number,
  ): Promise<{ rounds: PreviousRound[]; page: number; totalPages: number }> => {
    return authFetch(`/api/smm/bonus/rounds?scope=${scope}&page=${page}`);
  }, [authFetch]);

  const checkEligibility = useCallback(async (link: string): Promise<EligibilityResult> => {
    return authFetch(`/api/smm/bonus/eligibility?link=${encodeURIComponent(link)}`);
  }, [authFetch]);

  const submitBonus = useCallback(async (payload: SubmitBonusPayload): Promise<SubmitBonusResult> => {
    const data = await authFetch('/api/smm/bonus/submissions', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    invalidate();
    return data;
  }, [authFetch, invalidate]);

  const startRound = useCallback(async (roundDateStart: string, roundDateEnd: string) => {
    await authFetch('/api/smm/bonus/rounds', {
      method: 'POST',
      body: JSON.stringify({ roundDateStart, roundDateEnd }),
    });
    invalidate();
  }, [authFetch, invalidate]);

  const updateSubmission = useCallback(async (
    roundId: string,
    submissionId: string,
    updates: Partial<Pick<SmmSubmission, 'numLikes' | 'status' | 'bonusAmount' | 'sysComments' | 'adminApproval'>>,
  ) => {
    await authFetch(`/api/smm/bonus/rounds/${roundId}/submissions/${submissionId}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });
    invalidate();
  }, [authFetch, invalidate]);

  const deleteSubmission = useCallback(async (roundId: string, submissionId: string) => {
    await authFetch(`/api/smm/bonus/rounds/${roundId}/submissions/${submissionId}`, { method: 'DELETE' });
    invalidate();
  }, [authFetch, invalidate]);

  const updateUserTotal = useCallback(async (roundId: string, uid: string, amount: number) => {
    await authFetch(`/api/smm/bonus/rounds/${roundId}/totals`, {
      method: 'PATCH',
      body: JSON.stringify({ uid, amount }),
    });
    invalidate();
  }, [authFetch, invalidate]);

  return useMemo(() => ({
    fetchCurrentMe,
    fetchCurrentAll,
    fetchPreviousRounds,
    checkEligibility,
    submitBonus,
    startRound,
    updateSubmission,
    deleteSubmission,
    updateUserTotal,
    invalidate,
  }), [fetchCurrentMe, fetchCurrentAll, fetchPreviousRounds, checkEligibility, submitBonus, startRound, updateSubmission, deleteSubmission, updateUserTotal, invalidate]);
}
