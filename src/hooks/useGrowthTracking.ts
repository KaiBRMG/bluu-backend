'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { useAuthFetch } from '@/hooks/useAuthFetch';
import { getCache, invalidateCacheByPrefix, setCache } from '@/lib/queryCache';
import type { DayMap } from '@/lib/growth/metrics';
import type { GrowthAccount, GrowthSeries } from '@/types/firestore';
import type { GrowthPlatform } from '@/lib/growth/platform';
import type { GrowthCategory } from '@/lib/growth/category';

const CACHE_PREFIX = 'bluu_growth_';
const CACHE_KEY = `${CACHE_PREFIX}series_v1`;
const CACHE_TTL_MS = 5 * 60 * 1000;

interface GrowthPayload {
  accounts: GrowthAccount[];
  series: GrowthSeries[];
}

export interface AddGrowthAccountPayload {
  platform: GrowthPlatform;
  profileUrl: string;
  /** Optional: the grouping the account is filed under. */
  category: GrowthCategory | null;
}

/**
 * What the immediate timeline search found when post tracking was switched on.
 * `null` when nothing was searched — switching it off, or an account that was
 * already opted in.
 */
/**
 * What one manual account refresh actually bought.
 *
 * Every field is reported separately because the two halves are two billed
 * calls that succeed and fail independently — a response that collapsed them
 * into one boolean could not say "followers landed, the post read did not",
 * which is the outcome the user most needs to hear.
 */
export interface RefreshAccountResult {
  success: boolean;
  followersRead: boolean;
  /** Of this account's own posts — never counts the padding. */
  postsRead: number;
  trackedPosts: number;
  /** Other accounts' posts that rode the same billed call for free. */
  refreshedAlongside: number;
  /** Why the post half did not run, when it did not. */
  postsSkipped: string | null;
}

export type TrackPostsResult = {
  created: number;
  refreshed: number;
  /** Set when the toggle saved but the search did not produce anything usable. */
  error: string | null;
} | null;

/**
 * Growth Tracking data: every tracked account plus its full history.
 *
 * The whole history is fetched once and sliced client-side. That is deliberate:
 * a year of readings for a dozen accounts is a few tens of KB, while re-fetching
 * per range flick would be a Firestore read per click for data already in
 * memory. The range control is a pure filter, so it is also instant.
 *
 * Cached in sessionStorage for 5 minutes like the other SMM hooks. The data only
 * changes once a night, so a stale-by-minutes view costs nothing.
 */
export function useGrowthTracking() {
  const { user } = useAuth();
  const authFetch = useAuthFetch();

  const [accounts, setAccounts] = useState<GrowthAccount[]>([]);
  const [series, setSeries] = useState<GrowthSeries[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = useCallback(async (forceRefresh = false) => {
    if (!forceRefresh) {
      const cached = getCache<GrowthPayload>(CACHE_KEY, CACHE_TTL_MS);
      if (cached) {
        setAccounts(cached.accounts);
        setSeries(cached.series);
        setLoading(false);
        return;
      }
    }
    setLoading(true);
    setError(null);
    try {
      const data = await authFetch('/api/smm/growth/series') as GrowthPayload;
      setAccounts(data.accounts);
      setSeries(data.series);
      setCache(CACHE_KEY, data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load growth data');
    } finally {
      setLoading(false);
    }
  }, [authFetch]);

  useEffect(() => {
    if (!user) return;
    fetchAll();
  }, [user, fetchAll]);

  const refresh = useCallback(async () => {
    invalidateCacheByPrefix(CACHE_PREFIX);
    await fetchAll(true);
  }, [fetchAll]);

  /**
   * Adding is a network call that scrapes, so it can take 10–30s and can fail
   * with a message the user needs to read ("we could not find that page").
   * The error is thrown, not swallowed — the dialog stays open and shows it.
   */
  const addAccount = useCallback(async (payload: AddGrowthAccountPayload) => {
    await authFetch('/api/smm/growth/accounts', { method: 'POST', body: JSON.stringify(payload) });
    await refresh();
  }, [authFetch, refresh]);

  /**
   * Stop or resume an account.
   *
   * Stopping also stops the account's posts — the server does that in one pass
   * (see the PATCH route) rather than the client firing one request per post.
   * The count comes back so the caller can say what actually happened instead of
   * claiming a number; resuming always reports `0`, because resuming is
   * deliberately not symmetrical.
   */
  const setTracking = useCallback(async (id: string, isActive: boolean): Promise<number> => {
    const response = await authFetch(`/api/smm/growth/accounts/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ isActive }),
    }) as { postsStopped?: number };
    await refresh();
    return response.postsStopped ?? 0;
  }, [authFetch, refresh]);

  /**
   * Opt an X account into post-level tracking.
   *
   * Switching it **on** searches that account's timeline straight away rather
   * than waiting up to six hours for the nightly pass, so this call can take
   * 10–30s — the same wait as adding an account, and for the same reason. The
   * server returns what that search found; the caller reports it.
   *
   * The account row is updated in place rather than by refetching the whole
   * payload: this is one boolean, and the series a refetch would re-read is tens
   * of KB that did not change (rule 9). `setTracking` above still refetches,
   * because stopping an account changes what the charts show.
   */
  const setTrackPosts = useCallback(async (
    id: string,
    trackPosts: boolean,
  ): Promise<TrackPostsResult> => {
    const response = await authFetch(`/api/smm/growth/accounts/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ trackPosts }),
    }) as { discovery: TrackPostsResult };

    setAccounts((current) => current.map((a) => (a.id === id ? { ...a, trackPosts } : a)));
    // The session cache holds the pre-flip copy; drop it rather than write
    // through, since the next mount should read the server's own view — the
    // discovery pass just stamped `lastPostDiscoveryAt` and possibly
    // `postsWindowSaturated` on this document.
    invalidateCacheByPrefix(CACHE_PREFIX);
    return response.discovery ?? null;
  }, [authFetch]);

  /**
   * Re-file an account under a different category.
   *
   * The category is a label, not identity — the document id is platform +
   * handle — so this is a plain field write with no history consequences, and
   * the row is patched in place rather than refetching the whole payload: the
   * series a refetch would re-read is tens of KB that did not change (rule 9).
   */
  const setCategory = useCallback(async (id: string, category: GrowthCategory | null) => {
    await authFetch(`/api/smm/growth/accounts/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ category }),
    });
    setAccounts((current) => current.map((a) => (a.id === id ? { ...a, category } : a)));
    invalidateCacheByPrefix(CACHE_PREFIX);
  }, [authFetch]);

  const deleteAccount = useCallback(async (id: string) => {
    await authFetch(`/api/smm/growth/accounts/${id}`, { method: 'DELETE' });
    await refresh();
  }, [authFetch, refresh]);

  /**
   * Buy a reading for one account now — its followers and its tracked posts, on
   * two separate bills. The server owns the cooldown and the spend ceiling; this
   * only relays what happened.
   *
   * It force-refreshes rather than patching state locally: the call writes a new
   * follower reading into the series subcollection, and the panel's chart reads
   * that, not the account document. A local patch would move the headline figure
   * and leave the chart a day behind it.
   */
  const refreshAccount = useCallback(async (id: string): Promise<RefreshAccountResult> => {
    const result = await authFetch(`/api/smm/growth/accounts/${id}/refresh`, {
      method: 'POST',
    }) as RefreshAccountResult;
    await refresh();
    return result;
  }, [authFetch, refresh]);

  /** Account id → day map, the shape everything in `metrics.ts` takes. */
  const seriesById = useMemo(() => {
    const map = new Map<string, DayMap>();
    for (const s of series) map.set(s.accountId, s.days);
    return map;
  }, [series]);

  return useMemo(() => ({
    accounts,
    seriesById,
    loading,
    error,
    refresh,
    addAccount,
    setTracking,
    setTrackPosts,
    setCategory,
    deleteAccount,
    refreshAccount,
  }), [accounts, seriesById, loading, error, refresh, addAccount, setTracking, setTrackPosts, setCategory, deleteAccount, refreshAccount]);
}
