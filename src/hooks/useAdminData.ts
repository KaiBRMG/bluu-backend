'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/components/AuthProvider';
import type { PagePermissionDoc } from '@/types/firestore';
import type { PageDef, TeamspaceDef } from '@/lib/definitions';

interface AdminUser {
  uid: string;
  displayName: string;
  workEmail: string;
  groups: string[];
  photoURL?: string;
}

interface AdminGroup {
  id: string;
  name: string;
  level: number;
  members: string[];
}

interface AdminDataState {
  pages: PageDef[];
  teamspaces: TeamspaceDef[];
  pagePermissions: PagePermissionDoc[];
  groups: AdminGroup[];
  users: AdminUser[];
  loading: boolean;
  error: string | null;
}

export function useAdminData() {
  const { user } = useAuth();
  const [state, setState] = useState<AdminDataState>({
    pages: [],
    teamspaces: [],
    pagePermissions: [],
    groups: [],
    users: [],
    loading: true,
    error: null,
  });

  const fetchAdminData = useCallback(async () => {
    if (!user) return;

    try {
      setState(prev => ({ ...prev, loading: true, error: null }));
      const idToken = await user.getIdToken();

      const res = await fetch('/api/admin/pages', {
        headers: { Authorization: `Bearer ${idToken}` },
      });

      if (!res.ok) {
        if (res.status === 403) throw new Error('Admin access required');
        throw new Error(`Failed to fetch admin data: ${res.status}`);
      }

      const data = await res.json();
      setState({
        pages: data.pages || [],
        teamspaces: data.teamspaces || [],
        pagePermissions: data.pagePermissions || [],
        groups: data.groups || [],
        users: data.users || [],
        loading: false,
        error: null,
      });
    } catch (err) {
      console.error('Error fetching admin data:', err);
      setState(prev => ({
        ...prev,
        loading: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      }));
    }
  }, [user]);

  useEffect(() => {
    fetchAdminData();
  }, [fetchAdminData]);

  // updatePermission refreshes data after a successful write so the UI stays
  // in sync without a standing onSnapshot listener (which billed reads for all users).
  const updatePermission = useCallback(
    async (
      pageId: string,
      permissions: { groups: Record<string, true>; users: Record<string, true> }
    ) => {
      if (!user) return;

      const idToken = await user.getIdToken();
      const res = await fetch(`/api/admin/pages/${pageId}/permissions`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${idToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ permissions }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to update permissions');
      }

      // Refresh local state after a successful permission update
      await fetchAdminData();
    },
    [user, fetchAdminData]
  );

  return {
    ...state,
    refetch: fetchAdminData,
    updatePermission,
  };
}
