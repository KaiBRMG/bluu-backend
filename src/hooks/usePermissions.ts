'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { useUserData } from '@/hooks/useUserData';
import type { ResolvedAccess } from '@/types/firestore';
import type { TeamspaceDef } from '@/lib/definitions';
import { GROUP_HIERARCHY, GROUP_DISPLAY_NAMES } from '@/types/firestore';
import { PAGES, TEAMSPACES } from '@/lib/definitions';
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

  // Initialize state from cache immediately — no loading flash.
  // We still fire a background fetch on mount to validate permissionsVersion.
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

  // Track previous permittedPageIds to detect real changes
  const prevPermittedRef = useRef<string>('uninitialised');

  const fetchPermissions = useCallback(async () => {
    if (!user) {
      setState({ teamspaces: [], accessiblePages: [], loading: false, error: null });
      clearPermissionsCache();
      return;
    }

    try {
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
      const newPermissionsVersion: number = data.permissionsVersion ?? 0;

      const cachedAfterFetch = getCachedPermissions();
      const cachedVersion = cachedAfterFetch?.permissionsVersion ?? -1;
      const isStale = newPermissionsVersion > cachedVersion;

      setCachedPermissions({
        teamspaces: newTeamspaces,
        accessiblePages: newAccessiblePages,
        permissionsVersion: newPermissionsVersion,
      });

      // Sync prevPermittedRef so the permittedPageIds watcher doesn't fire a
      // redundant local derivation right after this fetch settles.
      if (userData?.permittedPageIds !== undefined) {
        prevPermittedRef.current = JSON.stringify(userData.permittedPageIds ?? []);
      }

      if (isStale || !cachedAfterFetch) {
        setState({
          teamspaces: newTeamspaces,
          accessiblePages: newAccessiblePages,
          loading: false,
          error: null,
        });
      } else {
        setState(prev => ({ ...prev, loading: false, error: null }));
      }
    } catch (err) {
      console.error('Error fetching permissions:', err);
      const cached = getCachedPermissions();
      if (!cached) {
        setState(prev => ({
          ...prev,
          loading: false,
          error: err instanceof Error ? err.message : 'Unknown error',
        }));
      }
    }
  }, [user, userData?.permittedPageIds]);

  // Initial fetch on mount — handles first-ever load, backfill of permittedPageIds,
  // and cache version validation. Does NOT re-run when userData changes.
  useEffect(() => {
    if (!user) {
      setState({ teamspaces: [], accessiblePages: [], loading: false, error: null });
      clearPermissionsCache();
      prevPermittedRef.current = 'uninitialised';
      return;
    }
    fetchPermissions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // React to permittedPageIds changes pushed via the users/{uid} onSnapshot.
  // Derives accessible pages locally from static PAGES/TEAMSPACES — 0 extra reads.
  // This fires after recomputeUserPermissions() has written the final authoritative
  // value, avoiding the race where groups changes before permittedPageIds is updated.
  useEffect(() => {
    if (!user || !userData) return;

    const currentPermitted = JSON.stringify(userData.permittedPageIds ?? []);
    if (prevPermittedRef.current === currentPermitted) return;
    prevPermittedRef.current = currentPermitted;

    const ids = new Set(userData.permittedPageIds ?? []);
    const accessiblePages: ResolvedAccess[] = PAGES
      .filter(p => ids.has(p.pageId))
      .map(p => ({ ...p, grantedVia: 'group' as const }));
    const usedTeamspaceIds = new Set(accessiblePages.map(p => p.teamspaceId));
    const teamspaces = TEAMSPACES.filter(t => usedTeamspaceIds.has(t.id));

    // Preserve the existing permissionsVersion — no server round-trip means no new
    // version. The version will be validated on the next API fetch (page reload or
    // explicit refetch).
    const cached = getCachedPermissions();
    setCachedPermissions({
      teamspaces,
      accessiblePages,
      permissionsVersion: cached?.permissionsVersion ?? 0,
    });

    setState({ teamspaces, accessiblePages, loading: false, error: null });
  }, [user, userData, userData?.permittedPageIds]);

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
