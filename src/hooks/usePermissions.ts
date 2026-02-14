'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { useUserData } from '@/hooks/useUserData';
import type { ResolvedAccess } from '@/types/firestore';
import type { TeamspaceDef } from '@/lib/definitions';
import { GROUP_HIERARCHY, GROUP_DISPLAY_NAMES } from '@/types/firestore';
import { getCachedPermissions, setCachedPermissions, clearPermissionsCache } from '@/lib/permissionsCache';

interface PermissionsState {
  teamspaces: TeamspaceDef[];
  accessiblePages: ResolvedAccess[];
  loading: boolean;
  error: string | null;
}

/**
 * Returns the display name of the user's highest-level group.
 */
export function getHighestGroupName(groups: string[]): string {
  if (!groups || groups.length === 0) return 'Unassigned';

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

  // Initialize state from cache immediately — no loading flash
  const [state, setState] = useState<PermissionsState>(() => {
    const cached = getCachedPermissions();
    if (cached) {
      return {
        teamspaces: cached.teamspaces,
        accessiblePages: cached.accessiblePages,
        loading: false,
        error: null,
      };
    }
    return {
      teamspaces: [],
      accessiblePages: [],
      loading: true,
      error: null,
    };
  });

  // Track previous groups to detect changes
  const prevGroupsRef = useRef<string>('');

  const fetchPermissions = useCallback(async () => {
    if (!user) {
      setState({ teamspaces: [], accessiblePages: [], loading: false, error: null });
      clearPermissionsCache();
      return;
    }

    try {
      // Don't set loading if we already have cached data — non-blocking refresh
      const cached = getCachedPermissions();
      if (!cached) {
        setState(prev => ({ ...prev, loading: true, error: null }));
      }

      const idToken = await user.getIdToken();
      const res = await fetch('/api/permissions/pages', {
        headers: { Authorization: `Bearer ${idToken}` },
      });

      if (!res.ok) {
        throw new Error(`Failed to fetch permissions: ${res.status}`);
      }

      const data = await res.json();
      const newTeamspaces = data.teamspaces || [];
      const newAccessiblePages = data.accessiblePages || [];

      // Update cache
      setCachedPermissions({ teamspaces: newTeamspaces, accessiblePages: newAccessiblePages });

      setState({
        teamspaces: newTeamspaces,
        accessiblePages: newAccessiblePages,
        loading: false,
        error: null,
      });
    } catch (err) {
      console.error('Error fetching permissions:', err);
      // Only show error if we have no cached data at all
      const cached = getCachedPermissions();
      if (!cached) {
        setState(prev => ({
          ...prev,
          loading: false,
          error: err instanceof Error ? err.message : 'Unknown error',
        }));
      }
    }
  }, [user]);

  // Fetch when user is available and groups change
  useEffect(() => {
    if (!user) {
      setState({ teamspaces: [], accessiblePages: [], loading: false, error: null });
      clearPermissionsCache();
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
