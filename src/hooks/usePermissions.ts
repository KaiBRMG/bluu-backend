'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { useUserData } from '@/hooks/useUserData';
import type { ResolvedAccess, TeamspaceDocument } from '@/types/firestore';
import { GROUP_HIERARCHY, GROUP_DISPLAY_NAMES } from '@/types/firestore';

interface PermissionsState {
  teamspaces: TeamspaceDocument[];
  accessiblePages: ResolvedAccess[];
  loading: boolean;
  error: string | null;
}

/**
 * Returns the display name of the user's highest-level group.
 */
export function getHighestGroupName(groups: string[]): string {
  if (!groups || groups.length === 0) return 'General';

  let highestSlug = groups[0];
  let highestLevel = GROUP_HIERARCHY[highestSlug] ?? -1;

  for (const slug of groups) {
    const level = GROUP_HIERARCHY[slug] ?? -1;
    if (level > highestLevel) {
      highestLevel = level;
      highestSlug = slug;
    }
  }

  return GROUP_DISPLAY_NAMES[highestSlug] || highestSlug;
}

export function usePermissions() {
  const { user } = useAuth();
  const { userData } = useUserData();
  const [state, setState] = useState<PermissionsState>({
    teamspaces: [],
    accessiblePages: [],
    loading: true,
    error: null,
  });

  // Track previous groups serialized to detect actual changes
  const prevGroupsRef = useRef<string>('');

  const fetchPermissions = useCallback(async () => {
    if (!user) {
      setState({ teamspaces: [], accessiblePages: [], loading: false, error: null });
      return;
    }

    try {
      setState(prev => ({ ...prev, loading: true, error: null }));
      const idToken = await user.getIdToken();

      const res = await fetch('/api/permissions/pages', {
        headers: { Authorization: `Bearer ${idToken}` },
      });

      if (!res.ok) {
        throw new Error(`Failed to fetch permissions: ${res.status}`);
      }

      const data = await res.json();
      setState({
        teamspaces: data.teamspaces || [],
        accessiblePages: data.accessiblePages || [],
        loading: false,
        error: null,
      });
    } catch (err) {
      console.error('Error fetching permissions:', err);
      setState(prev => ({
        ...prev,
        loading: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      }));
    }
  }, [user]);

  // Single effect: fetch when user is available and groups change
  useEffect(() => {
    if (!user) {
      setState({ teamspaces: [], accessiblePages: [], loading: false, error: null });
      return;
    }

    // Wait for userData to be loaded
    if (!userData) return;

    const currentGroups = JSON.stringify(userData.groups || []);
    if (prevGroupsRef.current === currentGroups) return;

    prevGroupsRef.current = currentGroups;
    fetchPermissions();
  }, [user, userData, fetchPermissions]);

  const canAccess = useCallback(
    (href: string): boolean => {
      return state.accessiblePages.some(p => p.href === href);
    },
    [state.accessiblePages]
  );

  return {
    ...state,
    refetch: fetchPermissions,
    canAccess,
  };
}
