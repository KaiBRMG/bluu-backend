'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuthFetch } from '@/hooks/useAuthFetch';
import type { ManagedFolder } from './manage';

export interface FolderProfile {
  id: string;
  name: string;
  os: string;
  osSpec: string;
}

interface FoldersPayload {
  folders: ManagedFolder[];
  profiles?: FolderProfile[];
  truncated?: boolean;
}

/**
 * The workspace's user-facing folders, fetched **when a dialog that needs them
 * opens** — never on window mount. Most sessions in this window never open a
 * management dialog, and the read costs a `GET /user` against the master
 * token's request budget (served from the server's 60s memo when warm).
 *
 * `withProfiles` also returns the workspace's profile list — only Edit folders
 * needs it, and only it pays for the walk. `setFolders` is for optimistic edits;
 * `reload(true)` re-reads the folders only (the profile list does not change
 * when membership does, so a recovery never re-walks it).
 */
export function useManagedFolders(enabled: boolean, { withProfiles = false } = {}) {
  const authFetch = useAuthFetch();
  const [folders, setFolders] = useState<ManagedFolder[]>([]);
  const [profiles, setProfiles] = useState<FolderProfile[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const load = useCallback(
    async (force: boolean, includeProfiles: boolean) => {
      setError(null);
      const params = new URLSearchParams();
      if (includeProfiles) params.set('profiles', '1');
      if (force) params.set('refresh', '1');
      const query = params.toString();
      try {
        const data: FoldersPayload = await authFetch(`/api/gologin/manage/folders${query ? `?${query}` : ''}`);
        if (!aliveRef.current) return;
        setFolders(data.folders ?? []);
        if (includeProfiles) {
          setProfiles(data.profiles ?? []);
          setTruncated(!!data.truncated);
        }
      } catch (err) {
        if (aliveRef.current) setError(err instanceof Error ? err.message : 'Could not load folders.');
      } finally {
        if (aliveRef.current) setLoaded(true);
      }
    },
    [authFetch],
  );

  useEffect(() => {
    if (enabled) void load(false, withProfiles);
  }, [enabled, withProfiles, load]);

  const reload = useCallback((force = false) => load(force, false), [load]);

  return {
    folders,
    setFolders,
    profiles,
    truncated,
    loading: enabled && !loaded,
    error,
    reload,
    /** Retry the first load exactly as it was made. */
    retry: useCallback(() => load(true, withProfiles), [load, withProfiles]),
  };
}
