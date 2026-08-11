'use client';

import { useCallback, useMemo } from 'react';
import { useAuthFetch } from '@/hooks/useAuthFetch';
import type { SmmPageSuggestion } from '@/types/firestore';

export interface SuggestionApprovalResult {
  success: boolean;
  /** Approve found no matching account — the caller confirms, then retries with `createAccount`. */
  accountMissing?: boolean;
  accountName?: string;
  created?: boolean;
}

/**
 * twitterx-page-suggestions — viral-account nominations from the Viral Accounts
 * page, reviewed in Bonus Management. Uncached: the pending list is small and
 * must reflect an approval/denial immediately.
 */
export function useSmmSuggestions() {
  const authFetch = useAuthFetch();

  const fetchPending = useCallback(async (): Promise<SmmPageSuggestion[]> => {
    const data = await authFetch('/api/smm/suggestions');
    return data.suggestions;
  }, [authFetch]);

  const submitSuggestion = useCallback(async (accountLink: string) => {
    return authFetch('/api/smm/suggestions', {
      method: 'POST',
      body: JSON.stringify({ accountLink }),
    });
  }, [authFetch]);

  const reviewSuggestion = useCallback(async (
    id: string,
    action: 'approve' | 'deny',
    createAccount = false,
  ): Promise<SuggestionApprovalResult> => {
    return authFetch(`/api/smm/suggestions/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ action, createAccount }),
    });
  }, [authFetch]);

  return useMemo(() => ({
    fetchPending,
    submitSuggestion,
    reviewSuggestion,
  }), [fetchPending, submitSuggestion, reviewSuggestion]);
}
