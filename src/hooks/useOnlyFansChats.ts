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

/**
 * The fan profile mirrored from the chat list — the fan panel's whole data
 * source, and free: it arrives on the payload the sync already pays for.
 *
 * Every field is nullable because the provider guarantees none of them. The
 * panel must render a fact only when it has one; a confident `$0` on a fan who
 * has spent thousands is worse than a blank.
 */
export interface OFFanProfileRow {
  about: string;
  location: string | null;
  joinDate: string | null;
  isVerified: boolean;
  subscribePrice: number;
  subscription: {
    status: string | null;
    isActive: boolean;
    duration: string | null;
    subscribedAt: string | null;
    expiresAt: string | null;
    renewedAt: string | null;
  } | null;
  spend: {
    total: number;
    tips: number;
    messages: number;
    posts: number;
    streams: number;
    subscriptions: number;
  } | null;
}

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
  /** Null on rows mirrored before the profile was, and on a webhook-created row. */
  profile?: OFFanProfileRow | null;
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
    profile: raw.profile ?? null,
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
  /**
   * Chat ids we have already tried to back-fill profiles for.
   *
   * This used to be a plain in-flight boolean, which was a cost bug: a fan the
   * forced sync could not reach (they are not in the first page of chats) stays
   * `fanMissing` forever, so **every subsequent snapshot re-fired a forced,
   * billed provider sync** — and each sync writes rows, which produces another
   * snapshot. One attempt per chat, ever, breaks the loop.
   */
  const hydrateAttemptedRef = useRef<Set<string>>(new Set());
  const hydrateInFlightRef = useRef(false);

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

  // Resolve the account id on its own, in parallel with the sync below.
  //
  // The list cannot attach its snapshot listener without an account id, and the
  // sync route only returns one *after* pulling the provider's chat list and
  // reconciling the mirror — seconds of work the inbox does not need in order to
  // start rendering what is already mirrored. This route is nearly free, so on a
  // cold session the list paints as soon as Firestore answers rather than after
  // the provider does. Skipped entirely when the id is already cached.
  useEffect(() => {
    if (accountId) return;
    let cancelled = false;
    authFetch('/api/onlyfans/account')
      .then((result) => {
        if (cancelled || !result?.accountId) return;
        setAccountId(result.accountId);
        setCache(ACCOUNT_CACHE_KEY, result.accountId);
      })
      // Not fatal: the sync below also returns the account id, so this is a
      // head start, not a dependency. Its failure is reported there.
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [accountId, authFetch]);

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
        // rather than leaving "Unknown fan" in the inbox — but only once per
        // chat, because a fan the sync cannot reach would otherwise re-trigger a
        // billed forced sync on every snapshot for the life of the window.
        const unhydrated = rows.filter(
          (r) => r.fanMissing && !hydrateAttemptedRef.current.has(r.id),
        );
        if (unhydrated.length > 0 && !hydrateInFlightRef.current) {
          for (const row of unhydrated) hydrateAttemptedRef.current.add(row.id);
          hydrateInFlightRef.current = true;
          sync('?refresh=1').finally(() => {
            hydrateInFlightRef.current = false;
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
