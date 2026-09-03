'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { getCache, setCache } from '@/lib/queryCache';
import type { CreatorRecipient } from '@/app/api/admin/notifications/creators/route';

export type { CreatorRecipient };

interface CreatorRecipientsState {
  creators: CreatorRecipient[];
  loading: boolean;
  error: string | null;
}

const CACHE_KEY = 'bluu_creator_recipients_v1';
const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Creator recipients for the Create Notification dialog only — every creator
 * has already linked or can link Telegram, the sole channel that reaches them
 * (see telegram.md). Not for any other surface: `useAdminCreators` (or
 * equivalent) is the general-purpose creator list.
 */
export function useCreatorRecipients() {
  const { user } = useAuth();
  const [state, setState] = useState<CreatorRecipientsState>(() => {
    const cached = getCache<CreatorRecipient[]>(CACHE_KEY, CACHE_TTL_MS);
    if (cached) return { creators: cached, loading: false, error: null };
    return { creators: [], loading: true, error: null };
  });

  const fetchData = useCallback(async (forceRefresh = false) => {
    if (!user) return;

    if (!forceRefresh) {
      const cached = getCache<CreatorRecipient[]>(CACHE_KEY, CACHE_TTL_MS);
      if (cached) {
        setState({ creators: cached, loading: false, error: null });
        return;
      }
    }

    try {
      setState(prev => ({ ...prev, loading: true, error: null }));
      const idToken = await user.getIdToken();

      const res = await fetch('/api/admin/notifications/creators', {
        headers: { Authorization: `Bearer ${idToken}` },
      });

      if (!res.ok) {
        throw new Error(`Failed to fetch creators: ${res.status}`);
      }

      const data = await res.json();
      const creators: CreatorRecipient[] = data.creators || [];
      setCache<CreatorRecipient[]>(CACHE_KEY, creators);
      setState({ creators, loading: false, error: null });
    } catch (err) {
      console.error('Error fetching creator recipients:', err);
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

  return { ...state, refetch: () => fetchData(true) };
}
