'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuthFetch } from '@/hooks/useAuthFetch';
// `types.ts` is the client-safe half of the adapter — `@/lib/gologin` itself is
// server-only (it reads GL_API_TOKEN), so never import the barrel from here.
import type { GoLoginProfile } from '@/lib/gologin/types';

interface ProfilesResponse {
  profiles: GoLoginProfile[];
  total: number;
  truncated: boolean;
  fetchedAtMs: number;
}

/**
 * The GoLogin window's only data source.
 *
 * Fetched **once on mount**, plus whatever the operator asks for with the
 * refresh button. There is deliberately no polling and no interval: a listing
 * costs one provider request per 30 profiles, and GoLogin answers a rate-limit
 * breach by revoking the API token outright.
 */
export function useGoLoginProfiles() {
  const authFetch = useAuthFetch();
  const [profiles, setProfiles] = useState<GoLoginProfile[]>([]);
  const [total, setTotal] = useState(0);
  const [truncated, setTruncated] = useState(false);
  const [fetchedAtMs, setFetchedAtMs] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Survives StrictMode's double-mount in dev and guards a late response
  // landing after the window is closed.
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const load = useCallback(
    async (force: boolean) => {
      if (force) setRefreshing(true);
      setError(null);
      try {
        const data: ProfilesResponse = await authFetch(
          `/api/gologin/profiles${force ? '?refresh=1' : ''}`,
        );
        if (!aliveRef.current) return;
        setProfiles(data.profiles ?? []);
        setTotal(data.total ?? 0);
        setTruncated(!!data.truncated);
        setFetchedAtMs(data.fetchedAtMs ?? Date.now());
      } catch (err) {
        if (!aliveRef.current) return;
        setError(err instanceof Error ? err.message : 'Could not load profiles.');
      } finally {
        if (aliveRef.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [authFetch],
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  const refresh = useCallback(() => load(true), [load]);

  return { profiles, total, truncated, fetchedAtMs, loading, refreshing, error, refresh };
}
