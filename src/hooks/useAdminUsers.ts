'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/components/AuthProvider';

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
  timeTracking?: boolean;
  includeIdleTime?: boolean;
  enableScreenshots?: boolean;
  timezone?: string;
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

export function useAdminUsers() {
  const { user } = useAuth();
  const [state, setState] = useState<AdminUsersState>({
    users: [],
    groups: [],
    loading: true,
    error: null,
  });

  const fetchData = useCallback(async () => {
    if (!user) return;

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
      setState({
        users: data.users || [],
        groups: data.groups || [],
        loading: false,
        error: null,
      });
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

      await fetchData();
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

      await fetchData();
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

      await fetchData();
    },
    [user, fetchData]
  );

  return {
    ...state,
    refetch: fetchData,
    updateUser,
    addGroupMembers,
    removeGroupMember,
  };
}
