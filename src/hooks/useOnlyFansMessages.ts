'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { collection, limit as fsLimit, onSnapshot, orderBy, query } from 'firebase/firestore';
import { db } from '@/firebase-config';
import { useAuthFetch } from '@/hooks/useAuthFetch';
import { getCache, setCache } from '@/lib/queryCache';

/**
 * One chat thread — history plus live messages.
 *
 * Two sources, deliberately:
 *
 *  - **History** is paged from the provider (`GET …/messages?cursor=`) and never
 *    mirrored to Firestore; a thread can run to thousands of messages that are
 *    read once, so writing them all would be the most expensive thing this
 *    feature does. The newest page is cached in sessionStorage so re-opening a
 *    thread in the same session is free.
 *  - **Live** messages come from the `messages` subcollection, written by the
 *    send route and the provider webhook. That is what makes an open thread
 *    update in realtime without polling.
 *
 * The two are merged and de-duplicated by message id — the same message
 * legitimately appears in both once the next history page is fetched.
 */

export interface OFMessageRow {
  id: string;
  chatId: string;
  text: string;
  createdAt: string;
  fromMe: boolean;
  price: number;
  isTip: boolean;
  isOpened: boolean;
  mediaCount: number;
  /** Set locally while a send is in flight. A send that fails is removed, not flagged. */
  pending?: boolean;
}

const PAGE_SIZE = 30;
const LIVE_LIMIT = 50;
const HISTORY_TTL = 60 * 1000;
const historyKey = (chatId: string) => `bluu_of_thread_v1:${chatId}`;

/**
 * @param reloadToken Bump to force a re-fetch of the newest history page for the
 *   chat already open — the chat list's refresh button does this, so refreshing
 *   updates the thread the operator is reading and not just the list beside it.
 *   The live tail needs no help: it is an `onSnapshot` and is already current.
 */
export function useOnlyFansMessages(
  accountId: string | null,
  chatId: string | null,
  reloadToken = 0,
) {
  const authFetch = useAuthFetch();

  const [history, setHistory] = useState<OFMessageRow[]>([]);
  const [live, setLive] = useState<OFMessageRow[]>([]);
  const [optimistic, setOptimistic] = useState<OFMessageRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // State, not a ref: `hasMore` is derived from it and must re-render the
  // "load older" affordance when a page exhausts the thread.
  const [cursor, setCursor] = useState<string | null>(null);

  // Compared against the token the effect last saw, so the effect can tell a
  // forced reload apart from a chat switch — the two want different behaviour
  // before the fetch, and identical behaviour after it.
  const seenReloadRef = useRef(reloadToken);

  // Initial page — and, when `reloadToken` changes, the newest page again.
  useEffect(() => {
    if (!chatId) {
      setHistory([]);
      setOptimistic([]);
      setCursor(null);
      return;
    }

    const isReload = seenReloadRef.current !== reloadToken;
    seenReloadRef.current = reloadToken;

    let cancelled = false;
    setError(null);

    // A reload deliberately touches none of the pre-fetch state:
    //  - it does not read the 60s sessionStorage cache, because serving the copy
    //    the operator just asked to replace is the one thing a refresh must
    //    never do;
    //  - it does not blank `history` or flip `loading`, so the thread stays
    //    readable while the page is in flight instead of flashing a skeleton;
    //  - it does not clear `optimistic`, so a send still in flight keeps its
    //    bubble.
    //
    // The fetch below then *replaces* history with the newest page, which is the
    // honest meaning of refresh: a thread paged far back collapses to page one,
    // exactly as re-opening it would. `loadOlder` walks back from there again.
    if (!isReload) {
      setOptimistic([]);

      const cached = getCache<{ messages: OFMessageRow[]; nextCursor: string | null }>(
        historyKey(chatId),
        HISTORY_TTL,
      );
      if (cached) {
        setHistory(cached.messages);
        setCursor(cached.nextCursor);
        setLoading(false);
      } else {
        setHistory([]);
        setCursor(null);
        setLoading(true);
      }
    }

    (async () => {
      try {
        const page = await authFetch(
          `/api/onlyfans/chats/${chatId}/messages?limit=${PAGE_SIZE}`,
        );
        if (cancelled) return;
        setHistory(page.messages ?? []);
        setCursor(page.nextCursor ?? null);
        setCache(historyKey(chatId), { messages: page.messages ?? [], nextCursor: page.nextCursor ?? null });
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load messages');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [chatId, authFetch, reloadToken]);

  // Live tail.
  useEffect(() => {
    if (!accountId || !chatId) {
      setLive([]);
      return;
    }
    const unsubscribe = onSnapshot(
      query(
        collection(db, 'onlyfans-chats', `${accountId}__${chatId}`, 'messages'),
        orderBy('createdAtMs', 'desc'),
        fsLimit(LIVE_LIMIT),
      ),
      (snap) => setLive(snap.docs.map((d) => d.data() as OFMessageRow)),
      (err) => console.error('[useOnlyFansMessages] live', err),
    );
    return () => unsubscribe();
  }, [accountId, chatId]);

  /** Oldest → newest, de-duplicated. Optimistic rows are dropped once real. */
  const messages = useMemo(() => {
    const byId = new Map<string, OFMessageRow>();
    for (const m of [...history, ...live]) byId.set(m.id, m);
    for (const m of optimistic) if (!byId.has(m.id)) byId.set(m.id, m);
    return [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }, [history, live, optimistic]);

  const hasMore = cursor !== null;

  const loadOlder = useCallback(async () => {
    if (!chatId || !cursor || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const page = await authFetch(
        `/api/onlyfans/chats/${chatId}/messages?cursor=${encodeURIComponent(cursor)}`,
      );
      setHistory((prev) => {
        const byId = new Map(prev.map((m) => [m.id, m]));
        for (const m of page.messages ?? []) byId.set(m.id, m);
        return [...byId.values()];
      });
      setCursor(page.nextCursor ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load older messages');
    } finally {
      setLoadingOlder(false);
    }
  }, [chatId, authFetch, loadingOlder, cursor]);

  const send = useCallback(
    async (text: string) => {
      if (!chatId || !text.trim() || sending) return false;
      // Cleared per attempt so a second identical failure still re-toasts — the
      // toast fires on a *change* of `error`.
      setError(null);
      const tempId = `pending-${Date.now()}`;
      setOptimistic((prev) => [
        ...prev,
        {
          id: tempId,
          chatId,
          text: text.trim(),
          createdAt: new Date().toISOString(),
          fromMe: true,
          price: 0,
          isTip: false,
          isOpened: false,
          mediaCount: 0,
          pending: true,
        },
      ]);
      setSending(true);
      try {
        const { message } = await authFetch(`/api/onlyfans/chats/${chatId}/messages`, {
          method: 'POST',
          body: JSON.stringify({ text: text.trim() }),
        });
        // The live listener delivers the real message; drop the placeholder.
        setOptimistic((prev) => prev.filter((m) => m.id !== tempId));
        if (message) setHistory((prev) => [message, ...prev]);
        return true;
      } catch (err) {
        // The composer is the single source of truth for unsent text: the caller
        // restores the draft, so leaving a failed bubble behind would show the
        // same message twice and never clear.
        setOptimistic((prev) => prev.filter((m) => m.id !== tempId));
        setError(err instanceof Error ? err.message : 'Message failed to send');
        return false;
      } finally {
        setSending(false);
      }
    },
    [chatId, authFetch, sending],
  );

  return { messages, loading, loadingOlder, hasMore, sending, error, loadOlder, send };
}
