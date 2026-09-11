'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, useAuthFetch } from '@/hooks/useAuthFetch';
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
export function useGoLoginProfiles(enabled = true) {
  const authFetch = useAuthFetch();
  const [profiles, setProfiles] = useState<GoLoginProfile[]>([]);
  const [total, setTotal] = useState(0);
  const [truncated, setTruncated] = useState(false);
  const [fetchedAtMs, setFetchedAtMs] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * The route's own code for the failure, when it sent one.
   *
   * Carried beside the message rather than folded into it, because one failure
   * — a token GoLogin no longer accepts — needs a different *screen*, not a
   * different sentence. Everything else stays an inline message with a Retry.
   */
  const [errorCode, setErrorCode] = useState<string | null>(null);

  /**
   * **Derived, not seeded.** `useState(enabled)` captured only the *first*
   * render's value, and `enabled` starts false for anyone whose `linked` state
   * arrives from a fetch (every admin, and any operator without the user-doc
   * seed). When it flipped true the request began with `loading` still false, so
   * the list rendered "No profiles in this workspace yet" for the entire walk —
   * which on a large workspace is many seconds of a confident, wrong answer.
   */
  const loading = enabled && !loaded;

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
      setErrorCode(null);
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
        setErrorCode(err instanceof ApiError ? (err.code ?? null) : null);
      } finally {
        // Set on the error path too: an error must render as an error, not as a
        // skeleton that never resolves.
        if (aliveRef.current) {
          setLoaded(true);
          setRefreshing(false);
        }
      }
    },
    [authFetch],
  );

  // `enabled` is false until the operator has linked a GoLogin account. Fetching
  // then would only ever return 428 — the remedy is onboarding, not a retry — so
  // the request is skipped rather than made and discarded.
  useEffect(() => {
    if (!enabled) return;
    void load(false);
  }, [load, enabled]);

  const refresh = useCallback(() => load(true), [load]);

  return { profiles, total, truncated, fetchedAtMs, loading, refreshing, error, errorCode, refresh };
}
