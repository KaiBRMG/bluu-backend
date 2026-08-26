'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { getCache, setCache } from '@/lib/queryCache';
import type { BasicUser } from '@/app/api/users/display-names/route';
import type { AdminGroup } from '@/hooks/useAdminUsers';

export type { BasicUser };

interface BasicUsersState {
  users: BasicUser[];
  groups: AdminGroup[];
  loading: boolean;
  error: string | null;
}

interface BasicUsersCacheData {
  users: BasicUser[];
  groups: AdminGroup[];
}

const CACHE_KEY = 'bluu_basic_users_v1';
const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * @param enabled Set false to skip the fetch entirely — for surfaces where the
 * user/group lists are only needed by controls the caller is not allowed to see.
 */
export function useBasicUsers(enabled = true) {
  const { user } = useAuth();
  const [state, setState] = useState<BasicUsersState>(() => {
    const cached = getCache<BasicUsersCacheData>(CACHE_KEY, CACHE_TTL_MS);
    if (cached) {
      return { users: cached.users, groups: cached.groups, loading: false, error: null };
    }
    // Disabled means nothing will ever load — never report a pending state.
    return { users: [], groups: [], loading: enabled, error: null };
  });

  const fetchData = useCallback(async (forceRefresh = false) => {
    if (!user || !enabled) return;

    if (!forceRefresh) {
      const cached = getCache<BasicUsersCacheData>(CACHE_KEY, CACHE_TTL_MS);
      if (cached) {
        setState({ users: cached.users, groups: cached.groups, loading: false, error: null });
        return;
      }
    }

    try {
      setState(prev => ({ ...prev, loading: true, error: null }));
      const idToken = await user.getIdToken();

      const res = await fetch('/api/users/display-names', {
        headers: { Authorization: `Bearer ${idToken}` },
      });

      if (!res.ok) {
        throw new Error(`Failed to fetch users: ${res.status}`);
      }

      const data = await res.json();
      const users: BasicUser[] = data.users || [];
      const groups: AdminGroup[] = data.groups || [];
      setCache<BasicUsersCacheData>(CACHE_KEY, { users, groups });
      setState({ users, groups, loading: false, error: null });
    } catch (err) {
      console.error('Error fetching basic users:', err);
      setState(prev => ({
        ...prev,
        loading: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      }));
    }
  }, [user, enabled]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return useMemo(() => ({
    ...state,
    refetch: () => fetchData(true),
  }), [state, fetchData]);
}
