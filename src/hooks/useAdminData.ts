'use client';

import { useEffect, useState, useCallback } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '@/firebase-config';
import { useAuth } from '@/components/AuthProvider';
import type { PageDocument, TeamspaceDocument, PermissionRole } from '@/types/firestore';

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
  pages: PageDocument[];
  teamspaces: TeamspaceDocument[];
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
    groups: [],
    users: [],
    loading: true,
    error: null,
  });

  // Initial fetch of all admin data
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

  // Initial fetch
  useEffect(() => {
    fetchAdminData();
  }, [fetchAdminData]);

  // Real-time listener for pages collection (so multiple admins see updates)
  useEffect(() => {
    if (!user) return;

    const unsubscribe = onSnapshot(
      collection(db, 'pages'),
      (snapshot) => {
        const updatedPages = snapshot.docs.map(doc => doc.data() as PageDocument);
        setState(prev => ({ ...prev, pages: updatedPages }));
      },
      (error) => {
        console.error('Pages snapshot error:', error);
      }
    );

    return () => unsubscribe();
  }, [user]);

  // Update permissions for a specific page
  const updatePermission = useCallback(
    async (
      pageId: string,
      permissions: { users: Record<string, PermissionRole>; groups: Record<string, PermissionRole> }
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

      // The onSnapshot listener will automatically update the local state
    },
    [user]
  );

  return {
    ...state,
    refetch: fetchAdminData,
    updatePermission,
  };
}
