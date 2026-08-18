'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuthFetch } from '@/hooks/useAuthFetch';
import { getCache, setCache } from '@/lib/queryCache';
import type { OFAttachmentRow } from '@/hooks/useOnlyFansMessages';

/**
 * The creator's media vault, for the composer's picker.
 *
 * **Every listing is a billed provider call**, which is the only fact that
 * shapes this hook:
 *
 *  - nothing is fetched until the dialog is actually open (`enabled`);
 *  - each page is cached in `sessionStorage`, so re-opening the picker — the
 *    normal rhythm of attaching to several chats in a row — is free;
 *  - paging is explicit ("Load more"), never an infinite scroll that bills as
 *    fast as the operator can flick.
 *
 * Vault media *is* `OFAttachment`: same normaliser, same expiring CDN links, so
 * the tiles resolve through `useResolvedMedia` exactly as message media does.
 */

export interface OFVaultListRow {
  id: string;
  name: string;
  kind: string;
  counts: { photos: number; videos: number; gifs: number; audios: number };
}

export type VaultType = 'photo' | 'video' | 'gif' | 'audio';

export interface VaultFilters {
  listId: string | null;
  type: VaultType | null;
  query: string;
}

const PAGE_SIZE = 24;

/**
 * Long, and safe to be: the vault is a library, not a feed. The one change that
 * matters — the operator's own upload — arrives through the composer, not here.
 */
const VAULT_TTL_MS = 5 * 60 * 1000;
const LISTS_TTL_MS = 30 * 60 * 1000;

const listsKey = (accountId: string | null) => `bluu_of_vault_lists_v1:${accountId ?? 'unknown'}`;
const mediaKey = (accountId: string | null, filters: VaultFilters, offset: number) =>
  `bluu_of_vault_v1:${accountId ?? 'unknown'}:${filters.listId ?? ''}:${filters.type ?? ''}:${filters.query}:${offset}`;

export function useOnlyFansVault(
  accountId: string | null,
  filters: VaultFilters,
  enabled: boolean,
) {
  const authFetch = useAuthFetch();

  const [lists, setLists] = useState<OFVaultListRow[]>([]);
  const [media, setMedia] = useState<OFAttachmentRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  // Bumped by `retry`. A failed first page has to be recoverable in place: the
  // dialog is a step inside composing a message, and making the operator close
  // and re-open it to get another attempt loses the composer's focus for a
  // network blip.
  const [attempt, setAttempt] = useState(0);

  // Categories are fetched once per session and then read from cache: they cost
  // a call and change about never.
  useEffect(() => {
    if (!enabled) return;

    const key = listsKey(accountId);
    const cached = getCache<OFVaultListRow[]>(key, LISTS_TTL_MS);
    if (cached) {
      setLists(cached);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const body = await authFetch('/api/onlyfans/vault/lists');
        if (cancelled) return;
        setLists(body.lists ?? []);
        setCache(key, body.lists ?? []);
      } catch {
        // A vault with no categories is still a usable vault — the grid below
        // works unfiltered. Failing the whole dialog over the chip row would be
        // the wrong trade.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [accountId, authFetch, enabled]);

  const filterKey = `${filters.listId ?? ''}|${filters.type ?? ''}|${filters.query}`;
  // Read inside the paging callback without making it a dependency — `loadMore`
  // must stay stable across a filter change or the button re-binds mid-scroll.
  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  const fetchPage = useCallback(
    async (offset: number): Promise<{ media: OFAttachmentRow[]; nextOffset: number | null }> => {
      const current = filtersRef.current;
      const key = mediaKey(accountId, current, offset);
      const cached = getCache<{ media: OFAttachmentRow[]; nextOffset: number | null }>(
        key,
        VAULT_TTL_MS,
      );
      if (cached) return cached;

      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
      if (current.listId) params.set('list', current.listId);
      if (current.type) params.set('type', current.type);
      if (current.query.trim()) params.set('q', current.query.trim());

      const body = await authFetch(`/api/onlyfans/vault?${params}`);
      const page = { media: body.media ?? [], nextOffset: body.nextOffset ?? null };
      setCache(key, page);
      return page;
    },
    [accountId, authFetch],
  );

  // First page, and a fresh first page whenever the filters move.
  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const page = await fetchPage(0);
        if (cancelled) return;
        setMedia(page.media);
        setNextOffset(page.nextOffset);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load the vault');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // `filterKey` stands in for the filters object, which is rebuilt each render.
  }, [enabled, filterKey, fetchPage, attempt]);

  const loadMore = useCallback(async () => {
    if (nextOffset === null || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await fetchPage(nextOffset);
      // De-duplicated by id: an item added to the vault mid-page-walk shifts the
      // offsets under us and would otherwise appear twice.
      setMedia((prev) => {
        const byId = new Map(prev.map((m) => [m.id, m]));
        for (const m of page.media) byId.set(m.id, m);
        return [...byId.values()];
      });
      setNextOffset(page.nextOffset);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load more media');
    } finally {
      setLoadingMore(false);
    }
  }, [fetchPage, nextOffset, loadingMore]);

  /** Re-run the first page after a failure. Cheap: a cached page still hits. */
  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  return {
    lists,
    media,
    loading,
    loadingMore,
    error,
    hasMore: nextOffset !== null,
    loadMore,
    retry,
  };
}
