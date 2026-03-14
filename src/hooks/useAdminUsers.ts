'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { getCache, setCache, invalidateCache } from '@/lib/queryCache';

export interface AdminFullUser {
  uid: string;
  workEmail: string;
  displayName: string;
  photoURL?: string;
  firstName: string;
  lastName: string;
  groups: string[];
  createdAt: string | null;
  lastLoginAt: string | null;
  isActive: boolean;
  role?: 'admin' | 'member';
  jobTitle?: string;
  employmentType?: string;
  gender?: string;
  DOB?: string | null;
  address?: {
    street?: string;
    city?: string;
    state?: string;
    zipCode?: string;
    country?: string;
  };
  contactInfo?: {
    phoneNumber?: string;
    countryCode?: string;
    personalEmail?: string;
    telegramHandle?: string;
    emergencyContactName?: string;
    emergencyContactNumber?: string;
    emergencyContactEmail?: string;
  };
  paymentMethod?: string;
  paymentInfo?: string;
  userComments?: string;
  includeIdleTime?: boolean;
  enableScreenshots?: boolean;
  hasPaidLeave?: boolean;
  remainingUnpaidLeave?: number;
  remainingPaidLeave?: number;
  timezone?: string;
  permittedPageIds?: string[];
}

export interface AdminGroup {
  id: string;
  name: string;
  description?: string;
  members: string[];
  isDefault: boolean;
  level: number;
}

interface AdminUsersState {
  users: AdminFullUser[];
  groups: AdminGroup[];
  loading: boolean;
  error: string | null;
}

interface AdminUsersCacheData {
  users: AdminFullUser[];
  groups: AdminGroup[];
}

const CACHE_KEY = 'bluu_admin_users_v1';
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
// Invalidated whenever group membership changes so useAdminData (sharing page) re-fetches fresh users
const ADMIN_DATA_CACHE_KEY = 'bluu_admin_pages_v1';

export function useAdminUsers() {
  const { user } = useAuth();
  const [state, setState] = useState<AdminUsersState>(() => {
    const cached = getCache<AdminUsersCacheData>(CACHE_KEY, CACHE_TTL_MS);
    if (cached) {
      return { users: cached.users, groups: cached.groups, loading: false, error: null };
    }
    return { users: [], groups: [], loading: true, error: null };
  });

  const fetchData = useCallback(async (forceRefresh = false) => {
    if (!user) return;

    if (!forceRefresh) {
      const cached = getCache<AdminUsersCacheData>(CACHE_KEY, CACHE_TTL_MS);
      if (cached) {
        setState({ users: cached.users, groups: cached.groups, loading: false, error: null });
        return;
      }
    }

    try {
      setState(prev => ({ ...prev, loading: true, error: null }));
      const idToken = await user.getIdToken();

      const res = await fetch('/api/admin/users', {
        headers: { Authorization: `Bearer ${idToken}` },
      });

      if (!res.ok) {
        if (res.status === 403) throw new Error('Admin access required');
        throw new Error(`Failed to fetch users: ${res.status}`);
      }

      const data = await res.json();
      const users: AdminFullUser[] = data.users || [];
      const groups: AdminGroup[] = data.groups || [];
      setCache<AdminUsersCacheData>(CACHE_KEY, { users, groups });
      setState({ users, groups, loading: false, error: null });
    } catch (err) {
      console.error('Error fetching admin users:', err);
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

  const updateUser = useCallback(
    async (targetUid: string, updates: Record<string, unknown>) => {
      if (!user) throw new Error('Not authenticated');
      const idToken = await user.getIdToken();

      const res = await fetch(`/api/admin/users/${targetUid}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${idToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(updates),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to update user');
      }

      invalidateCache(CACHE_KEY);
      await fetchData(true);
    },
    [user, fetchData]
  );

  const addGroupMembers = useCallback(
    async (groupId: string, uids: string[]) => {
      if (!user) throw new Error('Not authenticated');
      const idToken = await user.getIdToken();

      const res = await fetch(`/api/admin/groups/${groupId}/members`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${idToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ uids }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to add members');
      }

      invalidateCache(CACHE_KEY);
      invalidateCache(ADMIN_DATA_CACHE_KEY);
      await fetchData(true);
    },
    [user, fetchData]
  );

  const removeGroupMember = useCallback(
    async (groupId: string, uid: string) => {
      if (!user) throw new Error('Not authenticated');
      const idToken = await user.getIdToken();

      const res = await fetch(`/api/admin/groups/${groupId}/members`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${idToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ uid }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to remove member');
      }

      invalidateCache(CACHE_KEY);
      invalidateCache(ADMIN_DATA_CACHE_KEY);
      await fetchData(true);
    },
    [user, fetchData]
  );

  return {
    ...state,
    refetch: () => fetchData(true),
    updateUser,
    addGroupMembers,
    removeGroupMember,
  };
}
