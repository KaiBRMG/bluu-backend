'use client';

import { useMemo } from 'react';
import { useBasicUsers } from '@/hooks/useBasicUsers';

/**
 * Shared user-name resolution.
 *
 * Returns a `uid → displayName` map sourced from the cached basic-users list
 * (`useBasicUsers`, 5-min sessionStorage cache). Pages that need to turn user
 * UIDs into names should use this instead of issuing their own
 * `/api/users/display-names` fetch — every consumer then shares a single cached
 * request, and the map stays consistent across the app.
 *
 * Pair the returned `names` map with `resolveUserName(uid, names)` from
 * `@/components/DeletedUser` to render a name (or an italic "Deleted User"
 * placeholder when the UID is no longer present).
 */
export function useUserName(): { names: Record<string, string>; loading: boolean } {
  const { users, loading } = useBasicUsers();

  const names = useMemo(() => {
    const m: Record<string, string> = {};
    for (const u of users) m[u.uid] = u.displayName;
    return m;
  }, [users]);

  return { names, loading };
}
