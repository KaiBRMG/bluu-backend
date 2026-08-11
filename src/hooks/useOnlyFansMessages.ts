'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
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

export function useOnlyFansMessages(accountId: string | null, chatId: string | null) {
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

  // Initial page.
  useEffect(() => {
    if (!chatId) {
      setHistory([]);
      setOptimistic([]);
      setCursor(null);
      return;
    }

    let cancelled = false;
    setError(null);
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
  }, [chatId, authFetch]);

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
