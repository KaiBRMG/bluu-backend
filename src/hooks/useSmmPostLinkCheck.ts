'use client';

import { useEffect, useRef, useState } from 'react';
import { useAuthFetch } from '@/hooks/useAuthFetch';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { normalizePostLink } from '@/lib/smm/linkUtils';

const DEBOUNCE_MS = 400;

/**
 * "Is this post already in the content schedule?" — the live lookup behind the
 * Post link field in the schedule/edit dialogs.
 *
 * Three things keep it off the wire:
 *  - `enabled` — callers pass `false` until the link is well-formed and matches
 *    the selected account, so a half-typed URL never hits the API.
 *  - debounce — one request per pause in typing, not one per keystroke.
 *  - a module-level cache keyed by the **normalized** link, so re-typing or
 *    reopening the dialog with the same post is free, and every variant of the
 *    same tweet shares one entry.
 *
 * A late response for a link the user has already moved on from is discarded
 * (`latest`), so the answer always belongs to what's in the field.
 */
const cache = new Map<string, boolean>();

export function useSmmPostLinkCheck(
  link: string,
  { enabled = true, exclude }: {
    enabled?: boolean;
    /** The post being edited — it must not flag itself as its own duplicate. */
    exclude?: { accountId: string; postId: string };
  } = {},
): { checking: boolean; duplicate: boolean } {
  const authFetch = useAuthFetch();
  const debouncedLink = useDebouncedValue(link, DEBOUNCE_MS);

  const [checking, setChecking] = useState(false);
  const [duplicate, setDuplicate] = useState(false);
  const latest = useRef(0);

  const normalized = enabled ? normalizePostLink(debouncedLink) : '';
  const cacheKey = exclude ? `${normalized}|${exclude.accountId}/${exclude.postId}` : normalized;

  useEffect(() => {
    // Claim the slot first: any request still in flight for a previous link is
    // now stale and must not be allowed to write its answer.
    const seq = ++latest.current;

    if (!normalized) {
      setChecking(false);
      setDuplicate(false);
      return;
    }
    const cached = cache.get(cacheKey);
    if (cached !== undefined) {
      setChecking(false);
      setDuplicate(cached);
      return;
    }

    setChecking(true);
    const params = new URLSearchParams({ link: debouncedLink.trim() });
    if (exclude) {
      params.set('excludeAccountId', exclude.accountId);
      params.set('excludePostId', exclude.postId);
    }

    authFetch(`/api/smm/posts/check-link?${params.toString()}`)
      .then((data: { duplicate: boolean }) => {
        cache.set(cacheKey, data.duplicate);
        if (seq !== latest.current) return;
        setDuplicate(data.duplicate);
      })
      // A failed check must not block scheduling — the server re-checks on write.
      .catch(() => { if (seq === latest.current) setDuplicate(false); })
      .finally(() => { if (seq === latest.current) setChecking(false); });
    // `debouncedLink` is intentionally not a dependency: `normalized`/`cacheKey`
    // already capture every change that should trigger a new request, and the
    // raw link only varies by formatting the API ignores.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [normalized, cacheKey, authFetch]);

  return { checking, duplicate };
}

/** Drop cached verdicts after a post is created/edited/deleted. */
export function invalidatePostLinkCheck(): void {
  cache.clear();
}
