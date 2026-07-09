'use client';

import { useCallback, useMemo, useRef } from 'react';
import { useAuthFetch } from '@/hooks/useAuthFetch';
import type { SmmPost } from '@/types/firestore';

export interface SmmPostPayload {
  accountId: string;
  caption?: string;
  postDate?: string; // ISO
  postLink?: string;
}

export interface SmmPostsPage {
  posts: SmmPost[];
  total: number;
  totalPages: number;
}

/**
 * twitterx-content-schedule access. Post data is high-churn, so there is no
 * sessionStorage cache — just an in-memory per-week map so calendar week
 * navigation doesn't refetch within a mount. Any mutation clears it.
 */
export function useSmmPosts() {
  const authFetch = useAuthFetch();
  const weekCache = useRef(new Map<string, SmmPost[]>());

  /** Caller's posts between start/end (inclusive), keyed by the week's start ISO. */
  const fetchWeek = useCallback(async (start: Date, end: Date, forceRefresh = false): Promise<SmmPost[]> => {
    const key = start.toISOString();
    if (!forceRefresh && weekCache.current.has(key)) return weekCache.current.get(key)!;
    const data = await authFetch(
      `/api/smm/posts?view=week&start=${encodeURIComponent(start.toISOString())}&end=${encodeURIComponent(end.toISOString())}`,
    );
    weekCache.current.set(key, data.posts);
    return data.posts;
  }, [authFetch]);

  /** Admin content schedule: every user's posts in a week, with postedBy resolved. */
  const fetchWeekAll = useCallback(async (start: Date, end: Date): Promise<SmmPost[]> => {
    const data = await authFetch(
      `/api/smm/posts?view=week&scope=all&start=${encodeURIComponent(start.toISOString())}&end=${encodeURIComponent(end.toISOString())}`,
    );
    return data.posts;
  }, [authFetch]);

  const fetchAllPosts = useCallback(async (page: number): Promise<SmmPostsPage> => {
    return authFetch(`/api/smm/posts?view=all&page=${page}`);
  }, [authFetch]);

  const fetchAccountPosts = useCallback(async (accountId: string): Promise<SmmPost[]> => {
    const data = await authFetch(`/api/smm/posts?accountId=${encodeURIComponent(accountId)}`);
    return data.posts;
  }, [authFetch]);

  const clearCache = useCallback(() => {
    weekCache.current.clear();
  }, []);

  const createPost = useCallback(async (payload: SmmPostPayload) => {
    await authFetch('/api/smm/posts', { method: 'POST', body: JSON.stringify(payload) });
    clearCache();
  }, [authFetch, clearCache]);

  /** Returns the post's location, which changes when accountId is edited. */
  const updatePost = useCallback(async (
    accountId: string,
    postId: string,
    updates: Partial<SmmPostPayload>,
  ): Promise<{ accountId: string; postId: string }> => {
    const data = await authFetch(`/api/smm/posts/${accountId}/${postId}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });
    clearCache();
    return { accountId: data.accountId, postId: data.postId };
  }, [authFetch, clearCache]);

  const deletePost = useCallback(async (accountId: string, postId: string) => {
    await authFetch(`/api/smm/posts/${accountId}/${postId}`, { method: 'DELETE' });
    clearCache();
  }, [authFetch, clearCache]);

  return useMemo(() => ({
    fetchWeek,
    fetchWeekAll,
    fetchAllPosts,
    fetchAccountPosts,
    clearCache,
    createPost,
    updatePost,
    deletePost,
  }), [fetchWeek, fetchWeekAll, fetchAllPosts, fetchAccountPosts, clearCache, createPost, updatePost, deletePost]);
}
