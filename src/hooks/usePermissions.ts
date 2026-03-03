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

  const prevPermittedRef = useRef<string>('uninitialised');
  const prevGroupsRef = useRef<string>('uninitialised');
  const groupFallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // fetchPermissions: only needed for initial load and the groups-change fallback.
  // dep array only on [user] — does not depend on userData.
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

      // Sync prevPermittedRef so the permittedPageIds watcher doesn't re-derive
      // immediately after this fetch settles (they'd be identical).
      prevPermittedRef.current = JSON.stringify(
        newAccessiblePages.map((p: ResolvedAccess) => p.pageId).sort()
      );

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
  }, [user]);

  // Initial fetch on mount — handles first-ever load, permittedPageIds backfill,
  // and cache version validation.
  useEffect(() => {
    if (!user) {
      setState({ teamspaces: [], accessiblePages: [], loading: false, error: null });
      clearPermissionsCache();
      prevPermittedRef.current = 'uninitialised';
      prevGroupsRef.current = 'uninitialised';
      if (groupFallbackTimerRef.current) clearTimeout(groupFallbackTimerRef.current);
      return;
    }
    fetchPermissions();
  }, [user, fetchPermissions]);

  // Primary: react to permittedPageIds changes pushed via the users/{uid} onSnapshot.
  // Derives accessible pages locally — 0 extra reads. Fires after the server has
  // finished recomputeUserPermissions(), which is the final authoritative write.
  useEffect(() => {
    if (!user || !userData) return;

    const currentPermitted = JSON.stringify((userData.permittedPageIds ?? []).slice().sort());
    if (prevPermittedRef.current === currentPermitted) return;
    prevPermittedRef.current = currentPermitted;

    // Cancel any pending groups-fallback fetch — permittedPageIds already updated.
    if (groupFallbackTimerRef.current) {
      clearTimeout(groupFallbackTimerRef.current);
      groupFallbackTimerRef.current = null;
    }

    const ids = new Set(userData.permittedPageIds ?? []);
    const accessiblePages: ResolvedAccess[] = PAGES
      .filter(p => ids.has(p.pageId))
      .map(p => ({ ...p, grantedVia: 'group' as const }));
    const usedTeamspaceIds = new Set(accessiblePages.map(p => p.teamspaceId));
    const teamspaces = TEAMSPACES.filter(t => usedTeamspaceIds.has(t.id));

    const cached = getCachedPermissions();
    setCachedPermissions({
      teamspaces,
      accessiblePages,
      permissionsVersion: cached?.permissionsVersion ?? 0,
    });

    setState({ teamspaces, accessiblePages, loading: false, error: null });
  }, [user, userData]);

  // Fallback: if groups changed but permittedPageIds hasn't updated after 3 s
  // (i.e. recomputeUserPermissions failed silently server-side), fetch from the API.
  useEffect(() => {
    if (!user || !userData) return;

    const currentGroups = JSON.stringify((userData.groups ?? []).slice().sort());
    if (prevGroupsRef.current === currentGroups) return;
    prevGroupsRef.current = currentGroups;

    // Schedule a fallback API fetch. If permittedPageIds arrives first (primary
    // effect above), it will clear this timer before it fires.
    if (groupFallbackTimerRef.current) clearTimeout(groupFallbackTimerRef.current);
    groupFallbackTimerRef.current = setTimeout(() => {
      groupFallbackTimerRef.current = null;
      fetchPermissions();
    }, 3000);
  }, [user, userData, fetchPermissions]);

  // Clean up fallback timer on unmount.
  useEffect(() => {
    return () => {
      if (groupFallbackTimerRef.current) clearTimeout(groupFallbackTimerRef.current);
    };
  }, []);

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
