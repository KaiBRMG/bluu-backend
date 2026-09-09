'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { useAuthFetch } from '@/hooks/useAuthFetch';
import { getCache, invalidateCacheByPrefix, setCache } from '@/lib/queryCache';
import type { GrowthPost, GrowthSpendLedger } from '@/types/firestore';

const CACHE_PREFIX = 'bluu_growth_posts_';
const CACHE_KEY = `${CACHE_PREFIX}v1`;
const CACHE_TTL_MS = 5 * 60 * 1000;

interface PostsPayload {
  posts: GrowthPost[];
  spend: GrowthSpendLedger;
}

/**
 * Keep the session cache in step with an in-place edit, so a flip or a sync is
 * not undone the next time the page mounts from cache.
 *
 * Module scope rather than a hook body: it closes over nothing that changes, and
 * defining it inside would hand every memoized callback a different copy.
 */
function writeThrough(next: GrowthPost[]): void {
  const cached = getCache<PostsPayload>(CACHE_KEY, CACHE_TTL_MS);
  if (cached) setCache(CACHE_KEY, { ...cached, posts: next });
}

export interface SyncResult {
  post: GrowthPost;
  /** How many other posts rode along on the same billed call — see the route. */
  refreshedAlongside: number;
  estimatedCostUsd: number;
}

/**
 * Tracked X posts and their engagement readings.
 *
 * The whole roster is fetched once and sliced client-side, exactly as
 * `useGrowthTracking` does with the follower series: a few hundred posts with a
 * trimmed reading tail is a few tens of KB, while re-fetching per range or
 * metric flick would be a Firestore read per click for data already in memory.
 *
 * Cached in sessionStorage for 5 minutes. Readings land on the refresh cron's
 * schedule, so a stale-by-minutes view costs nothing — and every surface states
 * when its numbers were actually taken rather than implying they are live.
 */
export function useGrowthPosts() {
  const { user } = useAuth();
  const authFetch = useAuthFetch();

  const [posts, setPosts] = useState<GrowthPost[]>([]);
  const [spend, setSpend] = useState<GrowthSpendLedger | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = useCallback(async (forceRefresh = false) => {
    if (!forceRefresh) {
      const cached = getCache<PostsPayload>(CACHE_KEY, CACHE_TTL_MS);
      if (cached) {
        setPosts(cached.posts);
        setSpend(cached.spend);
        setLoading(false);
        return;
      }
    }
    setLoading(true);
    setError(null);
    try {
      const data = await authFetch('/api/smm/growth/posts') as PostsPayload;
      setPosts(data.posts);
      setSpend(data.spend);
      setCache(CACHE_KEY, data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load tracked posts');
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
   * Track a post from its link. This is a network call that scrapes, so it takes
   * 10–30s and can fail with a message the user needs to read ("we could not
   * find that post"). The error is thrown rather than swallowed so the input can
   * stay open and show it.
   */
  const trackPost = useCallback(async (url: string) => {
    await authFetch('/api/smm/growth/posts', {
      method: 'POST',
      body: JSON.stringify({ url }),
    });
    await refresh();
  }, [authFetch, refresh]);

  const setPostTracking = useCallback(async (id: string, isActive: boolean) => {
    await authFetch(`/api/smm/growth/posts/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ isActive }),
    });
    // A single boolean flip does not justify re-reading the whole roster (rule 9).
    setPosts((current) => {
      const next = current.map((p) => (p.id === id ? { ...p, isActive } : p));
      writeThrough(next);
      return next;
    });
  }, [authFetch]);

  const deletePost = useCallback(async (id: string) => {
    await authFetch(`/api/smm/growth/posts/${id}`, { method: 'DELETE' });
    setPosts((current) => {
      const next = current.filter((p) => p.id !== id);
      writeThrough(next);
      return next;
    });
  }, [authFetch]);

  /**
   * Read one post now. The server enforces the cooldown and refuses with a 429
   * carrying the wait — a client-side timer would be a suggestion, and every
   * skipped suggestion spends money.
   *
   * The response carries the updated post, which is merged in place: the same
   * call refreshed up to nineteen others, but their readings arrive on the next
   * natural load rather than costing a full re-fetch here.
   */
  const syncPost = useCallback(async (id: string): Promise<SyncResult> => {
    const result = await authFetch(`/api/smm/growth/posts/${id}/sync`, {
      method: 'POST',
    }) as SyncResult;

    setPosts((current) => {
      const next = current.map((p) => (p.id === id ? result.post : p));
      writeThrough(next);
      return next;
    });
    return result;
  }, [authFetch]);

  /**
   * Pull one post's **complete** reading history.
   *
   * The list payload trims history for the wire, which is right for a table of
   * three hundred rows and wrong for the detail sheet, where the reading log is
   * the thing that makes every figure above it a measurement rather than a
   * claim. One document read, on open, merged in place.
   *
   * Failure is deliberately silent: the sheet already has the trimmed series and
   * renders correctly from it, so a failed enrichment must not replace working
   * content with an error.
   */
  const loadFullHistory = useCallback(async (id: string) => {
    try {
      const { post } = await authFetch(`/api/smm/growth/posts/${id}`) as { post: GrowthPost };
      setPosts((current) => {
        const next = current.map((p) => (p.id === id ? post : p));
        writeThrough(next);
        return next;
      });
    } catch {
      // Keep the trimmed history already on screen.
    }
  }, [authFetch]);

  const postsById = useMemo(
    () => new Map(posts.map((p) => [p.id, p])),
    [posts],
  );

  return useMemo(() => ({
    posts,
    postsById,
    spend,
    loading,
    error,
    refresh,
    trackPost,
    setPostTracking,
    deletePost,
    syncPost,
    loadFullHistory,
  }), [posts, postsById, spend, loading, error, refresh, trackPost, setPostTracking, deletePost, syncPost, loadFullHistory]);
}
