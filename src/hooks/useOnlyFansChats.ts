'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { collection, limit as fsLimit, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { db } from '@/firebase-config';
import { useAuthFetch } from '@/hooks/useAuthFetch';
import { getCache, setCache } from '@/lib/queryCache';

/**
 * The OnlyFans chat list.
 *
 * Reads the Firestore **mirror**, not the provider: `onSnapshot` gives realtime
 * updates for free (webhook writes land in the same docs) and costs one read per
 * changed row instead of a billed provider call per refresh. `GET
 * /api/onlyfans/chats` is called once on mount purely to warm that mirror — it
 * is rate limited server-side, so mounting repeatedly is cheap.
 */

export interface OFChatRow {
  id: string;
  accountId: string;
  fan: { id: string; name: string; username: string; avatar: string | null };
  lastMessageId: string | null;
  lastMessageText: string;
  lastMessageAt: string | null;
  lastMessageAtMs: number;
  lastMessageFromMe: boolean;
  unreadCount: number;
  spentTotal: number;
  isPinned: boolean;
  canSendMessage: boolean;
  /** True when the row was created by a webhook before the fan was ever synced. */
  fanMissing?: boolean;
}

/**
 * A webhook writes only what a message tells it — a chat that has never been
 * synced therefore arrives without profile fields. Fill them so the list can
 * render, and flag the row so the hook can pull the real values once.
 */
function hydrate(raw: Partial<OFChatRow>): OFChatRow {
  const id = raw.id ?? '';
  return {
    id,
    accountId: raw.accountId ?? '',
    fan: raw.fan ?? { id, name: 'Unknown fan', username: `u${id}`, avatar: null },
    lastMessageId: raw.lastMessageId ?? null,
    lastMessageText: raw.lastMessageText ?? '',
    lastMessageAt: raw.lastMessageAt ?? null,
    lastMessageAtMs: raw.lastMessageAtMs ?? 0,
    lastMessageFromMe: raw.lastMessageFromMe ?? false,
    unreadCount: raw.unreadCount ?? 0,
    spentTotal: raw.spentTotal ?? 0,
    isPinned: raw.isPinned ?? false,
    canSendMessage: raw.canSendMessage ?? true,
    fanMissing: !raw.fan,
  };
}

const PAGE_SIZE = 50;
const ACCOUNT_CACHE_KEY = 'bluu_of_account_v1';
const ACCOUNT_CACHE_TTL = 30 * 60 * 1000;

export function useOnlyFansChats() {
  const authFetch = useAuthFetch();

  // Cached so the snapshot listener can attach on the first render instead of
  // waiting a round trip for an id that effectively never changes.
  const [accountId, setAccountId] = useState<string | null>(
    () => getCache<string>(ACCOUNT_CACHE_KEY, ACCOUNT_CACHE_TTL),
  );
  const [chats, setChats] = useState<OFChatRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pageLimit, setPageLimit] = useState(PAGE_SIZE);
  const [hasMore, setHasMore] = useState(true);

  const nextOffsetRef = useRef<number | null>(PAGE_SIZE);
  // Guards the profile back-fill below against re-firing on its own snapshot.
  const pendingHydrateRef = useRef(false);

  const sync = useCallback(
    async (params: string) => {
      const result = await authFetch(`/api/onlyfans/chats${params}`);
      if (result?.accountId) {
        setAccountId(result.accountId);
        setCache(ACCOUNT_CACHE_KEY, result.accountId);
      }
      nextOffsetRef.current = result?.nextOffset ?? null;
      setHasMore(result?.nextOffset != null);
      return result;
    },
    [authFetch],
  );

  // Warm the mirror once per mount. `loading` is cleared by the snapshot
  // listener, not here: clearing it when the sync resolves would render the
  // empty state for the moment between the sync and the first snapshot. The
  // one case the listener can't cover is a sync that fails outright, so that
  // path clears it explicitly.
  useEffect(() => {
    let cancelled = false;
    sync('').catch((err: Error) => {
      if (cancelled) return;
      setError(err.message);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [sync]);

  // Live list.
  useEffect(() => {
    if (!accountId) return;
    const unsubscribe = onSnapshot(
      query(
        collection(db, 'onlyfans-chats'),
        where('accountId', '==', accountId),
        orderBy('lastMessageAtMs', 'desc'),
        fsLimit(pageLimit),
      ),
      (snap) => {
        const rows = snap.docs.map((d) => hydrate(d.data() as Partial<OFChatRow>));
        setChats(rows);
        setLoading(false);
        // A webhook can create a chat row for a fan we have never synced, so the
        // row arrives without profile fields. Pull the list once to fill them in
        // rather than leaving "Unknown fan" in the inbox.
        if (rows.some((r) => r.fanMissing) && !pendingHydrateRef.current) {
          pendingHydrateRef.current = true;
          sync('?refresh=1').finally(() => {
            pendingHydrateRef.current = false;
          });
        }
      },
      (err) => {
        console.error('[useOnlyFansChats]', err);
        setError('Could not load chats');
        setLoading(false);
      },
    );
    return () => unsubscribe();
  }, [accountId, pageLimit, sync]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      await sync('?refresh=1');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Refresh failed');
    } finally {
      setRefreshing(false);
    }
  }, [sync]);

  /** Pull the next page of older chats from the provider into the mirror. */
  const loadMore = useCallback(async () => {
    const offset = nextOffsetRef.current;
    if (offset == null || refreshing) return;
    setRefreshing(true);
    try {
      await sync(`?offset=${offset}`);
      setPageLimit((n) => n + PAGE_SIZE);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load more chats');
    } finally {
      setRefreshing(false);
    }
  }, [sync, refreshing]);

  return { accountId, chats, loading, refreshing, error, hasMore, refresh, loadMore };
}
