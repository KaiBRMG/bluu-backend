'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { useAuthFetch } from '@/hooks/useAuthFetch';
import { getCache, setCache } from '@/lib/queryCache';

export interface SmmUser {
  uid: string;
  displayName: string;
  photoURL: string | null;
}

const CACHE_KEY = 'bluu_smm_users_v1';
const CACHE_TTL_MS = 5 * 60 * 1000;

/** Non-archived SMM-group members for the admin 'assigned' picker. */
export function useSmmUsers() {
  const { user } = useAuth();
  const authFetch = useAuthFetch();

  const [users, setUsers] = useState<SmmUser[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchUsers = useCallback(async () => {
    const cached = getCache<SmmUser[]>(CACHE_KEY, CACHE_TTL_MS);
    if (cached) {
      setUsers(cached);
      setLoading(false);
      return;
    }
    try {
      const data = await authFetch('/api/smm/users');
      setUsers(data.users);
      setCache(CACHE_KEY, data.users);
    } catch (err) {
      console.error('[useSmmUsers] fetch failed:', err);
    } finally {
      setLoading(false);
    }
  }, [authFetch]);

  useEffect(() => {
    if (!user) return;
    fetchUsers();
  }, [user, fetchUsers]);

  return { users, loading };
}
