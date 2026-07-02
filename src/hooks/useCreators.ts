'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { getCache, setCache } from '@/lib/queryCache';
import type { Creator } from '@/lib/campaignTracking';

const CACHE_KEY = 'bluu_creators_v2';
const TTL = 5 * 60 * 1000;

/**
 * Fetches and caches the active creator list (5-min sessionStorage TTL).
 * Used on pages that display creator names/avatars in tabs and content areas.
 */
export function useCreators(): Creator[] {
  const { user } = useAuth();
  const [creators, setCreators] = useState<Creator[]>([]);

  useEffect(() => {
    if (!user) return;

    const cached = getCache<Creator[]>(CACHE_KEY, TTL);
    if (cached) {
      setCreators(cached);
      return;
    }

    let cancelled = false;
    user.getIdToken().then(token => {
      fetch('/api/creators', { headers: { Authorization: `Bearer ${token}` } })
        .then(r => r.json())
        .then(data => {
          if (cancelled) return;
          // Employee-facing visibility is governed by `isArchived` only — an
          // inactive (portal-login-disabled) creator's data must still show here.
          const visible = (data.creators ?? []).filter(
            (c: Creator & { isArchived?: boolean }) => c.isArchived !== true
          );
          setCreators(visible);
          setCache(CACHE_KEY, visible);
        })
        .catch(() => {});
    });
    return () => { cancelled = true; };
  }, [user]);

  return creators;
}
