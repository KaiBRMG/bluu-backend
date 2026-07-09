'use client';

import { useCallback, useMemo } from 'react';
import { useAuthFetch } from '@/hooks/useAuthFetch';
import { getCache, invalidateCacheByPrefix, setCache } from '@/lib/queryCache';
import type { SmmBonusRound, SmmSubmission } from '@/types/firestore';

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
}

export interface SubmitBonusPayload {
  accountId: string;
  postId: string;
  originalLink?: string;
  originalAccId?: string;
  numLikes: number;
  screenshotLink?: string;
}

export interface SubmitBonusResult {
  bonusAmount: number;
  status: string;
  sysComments: string;
  residualCreated: boolean;
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

  const fetchCurrentAll = useCallback(async (force = false): Promise<CurrentRoundAll> => {
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
