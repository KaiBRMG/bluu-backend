'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { collection, limit as fsLimit, onSnapshot, orderBy, query } from 'firebase/firestore';
import { db } from '@/firebase-config';
import { useAuthFetch } from '@/hooks/useAuthFetch';
import { getCacheEntry, setCache } from '@/lib/queryCache';

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

/**
 * Client mirror of `OFAttachment`. The `urls` are expiring provider CDN links
 * that no browser can fetch — they exist to be handed to
 * `useResolvedMedia`, never to an `<img>`.
 *
 * All three are **null on live messages**: the Firestore mirror strips them
 * before writing, because a signed link is dead long before anything reads the
 * doc back. The metadata beside them is what lets a tile lay itself out anyway.
 */
export interface OFAttachmentRow {
  id: string;
  type: 'photo' | 'video' | 'gif' | 'audio' | 'other';
  canView: boolean;
  isDrm: boolean;
  width: number | null;
  height: number | null;
  duration: number | null;
  /** Bytes of the full file when the provider reported one. Absent on older rows. */
  sizeBytes?: number | null;
  /**
   * Source links, all expiring and all blanked before the row is mirrored.
   *
   * `video240` / `video720` are the provider's transcoded renditions and are
   * absent on rows written before they were modelled — which is why every read
   * of them is optional. Playing `full` when a rendition exists costs an order
   * of magnitude more, so the viewer prefers a rendition and makes source
   * resolution an explicit choice.
   */
  urls: {
    full: string | null;
    preview: string | null;
    thumb: string | null;
    video240?: string | null;
    video720?: string | null;
  };
}

export interface OFMessageRow {
  id: string;
  chatId: string;
  text: string;
  createdAt: string;
  fromMe: boolean;
  /** PPV unlock price. Always 0 on a tip — tips carry money in `tipAmount`. */
  price: number;
  /** A tip. `text` is the fan's own note, with the provider's boilerplate stripped. */
  isTip: boolean;
  /** Amount tipped, USD. Absent on rows written before tips were modelled. */
  tipAmount?: number;
  isOpened: boolean;
  mediaCount: number;
  /** May be absent on rows written before media was modelled. */
  attachments?: OFAttachmentRow[];
  /** Pinned on OnlyFans. Absent on rows written before pinning was modelled. */
  isPinned?: boolean;
  /** Liked by us. Absent on rows written before liking was modelled. */
  isLiked?: boolean;
  /** False when the provider will refuse a pin for this message. */
  canBePinned?: boolean;
  /** Set locally while a send is in flight. A send that fails is removed, not flagged. */
  pending?: boolean;
}

/**
 * A local override of a message's pin/like state.
 *
 * Needed because the two halves of a thread are read-only from the client's
 * point of view in *different* ways: history is fetched state we could patch,
 * but the live tail is an `onSnapshot` we cannot write to and which will keep
 * re-delivering the pre-change row until the provider's own copy catches up.
 * Applying the override at merge time covers both without either source
 * fighting it back.
 */
interface MessageFlags {
  isPinned?: boolean;
  isLiked?: boolean;
}

/**
 * Does this copy of a message carry media links we could actually resolve?
 *
 * Less decisive than it used to be — the media cache can now serve a file it has
 * seen before with no source link at all — but still worth keeping: a copy with
 * links can fetch media that has *never* been cached, and one without cannot.
 */
function hasLiveMediaUrls(message: OFMessageRow | undefined): boolean {
  return !!message?.attachments?.some(
    (a) => a.urls.preview || a.urls.thumb || a.urls.full || a.urls.video720 || a.urls.video240,
  );
}

/**
 * Reconcile two copies of the same message.
 *
 * History (fetched from the provider) and the live tail (read from Firestore)
 * legitimately overlap, and the live copy normally wins because it is the newer
 * fact. Media is the exception: the mirror **strips CDN links before writing**,
 * so a naive "live wins" blanks the images on any message that has arrived both
 * ways. Keep the newer row, but keep whichever attachments can still be shown.
 */
function mergeMessage(existing: OFMessageRow | undefined, next: OFMessageRow): OFMessageRow {
  if (!existing) return next;
  if (hasLiveMediaUrls(next) || !hasLiveMediaUrls(existing)) return next;
  return { ...next, attachments: existing.attachments };
}

/**
 * What the composer hands to `send`.
 *
 * `mediaIds` mixes staged uploads (`ofapi_media_…`) and vault ids freely — the
 * provider takes both in one field, so nothing above it has to track which is
 * which. `previewIds` is only meaningful with a `price`: it names the members of
 * `mediaIds` that stay visible outside the paywall.
 */
export interface SendInput {
  text: string;
  /**
   * Id of the message being replied to.
   *
   * Send-only: the provider accepts it but does **not** report it back on any
   * message it returns, so a reply cannot be rendered as a quoted bubble in the
   * thread — not for the fan's replies to us, and not for our own. The composer's
   * quote strip is the only place the relationship is visible on this surface.
   */
  replyToMessageId?: string;
  mediaIds?: string[];
  previewIds?: string[];
  /** 0, or between 3 and 200 — the provider's own bounds. */
  price?: number;
  lockedText?: boolean;
}

const PAGE_SIZE = 30;
const LIVE_LIMIT = 50;

/**
 * How long a cached thread is worth **showing**.
 *
 * This was 60s, which made re-opening a chat feel broken: an operator who spent
 * a minute in another thread came back to a blank pane and a full skeleton, even
 * though nothing had changed. Ten minutes is safe because the cache is never the
 * whole truth — the live tail is an `onSnapshot` that is always current, and the
 * revalidation below replaces the page moments later. The cache only decides
 * what the operator looks at *while* that happens.
 */
const HISTORY_SHOW_TTL = 10 * 60 * 1000;

/**
 * How long a cached thread is worth **trusting without asking**.
 *
 * Inside this window, re-opening a chat makes no request at all. That matters
 * twice over: every history fetch is a billed provider call, and flicking
 * between two threads is the single most common thing an operator does.
 */
const HISTORY_FRESH_MS = 20 * 1000;

// Account-scoped: the same chat id under a different account is a different
// thread (Phase 4 makes that routine rather than theoretical).
const historyKey = (accountId: string | null, chatId: string) =>
  `bluu_of_thread_v2:${accountId ?? 'unknown'}:${chatId}`;

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
  const [flags, setFlags] = useState<Record<string, MessageFlags>>({});
  const flagsRef = useRef(flags);
  flagsRef.current = flags;
  const [loading, setLoading] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // State, not a ref: `hasMore` is derived from it and must re-render the
  // "load older" affordance when a page exhausts the thread.
  const [cursor, setCursor] = useState<string | null>(null);

  // A retry from the thread's own error state. Added to the caller's token so
  // both paths run the identical "re-pull the newest page" effect.
  const [localReload, setLocalReload] = useState(0);
  const effectiveReloadToken = reloadToken + localReload;

  // Compared against the token the effect last saw, so the effect can tell a
  // forced reload apart from a chat switch — the two want different behaviour
  // before the fetch, and identical behaviour after it.
  const seenReloadRef = useRef(effectiveReloadToken);

  // Initial page — and, when `reloadToken` changes, the newest page again.
  useEffect(() => {
    if (!chatId) {
      setHistory([]);
      setOptimistic([]);
      setCursor(null);
      return;
    }

    const isReload = seenReloadRef.current !== effectiveReloadToken;
    seenReloadRef.current = effectiveReloadToken;

    let cancelled = false;
    setError(null);

    // A reload deliberately touches none of the pre-fetch state:
    //  - it does not read the sessionStorage cache, because serving the copy the
    //    operator just asked to replace is the one thing a refresh must never
    //    do (and it passes `refresh=1` so the server's memo cannot either);
    //  - it does not blank `history` or flip `loading`, so the thread stays
    //    readable while the page is in flight instead of flashing a skeleton;
    //  - it does not clear `optimistic`, so a send still in flight keeps its
    //    bubble.
    //
    // The fetch below then *replaces* history with the newest page, which is the
    // honest meaning of refresh: a thread paged far back collapses to page one,
    // exactly as re-opening it would. `loadOlder` walks back from there again.
    const key = historyKey(accountId, chatId);

    if (!isReload) {
      setOptimistic([]);

      const cached = getCacheEntry<{ messages: OFMessageRow[]; nextCursor: string | null }>(
        key,
        HISTORY_SHOW_TTL,
      );
      if (cached) {
        setHistory(cached.data.messages);
        setCursor(cached.data.nextCursor);
        setLoading(false);

        // Fresh enough to trust outright: re-opening a thread you were just in
        // costs nothing and shows instantly. The live tail keeps it honest.
        if (cached.ageMs < HISTORY_FRESH_MS) return;
      } else {
        setHistory([]);
        setCursor(null);
        setLoading(true);
      }
    }

    (async () => {
      try {
        // A reload is an explicit "give me the current truth", so it must skip
        // the server's page memo as well as the client cache below.
        const page = await authFetch(
          `/api/onlyfans/chats/${chatId}/messages?limit=${PAGE_SIZE}${isReload ? '&refresh=1' : ''}`,
        );
        if (cancelled) return;
        setHistory(page.messages ?? []);
        setCursor(page.nextCursor ?? null);
        setCache(key, { messages: page.messages ?? [], nextCursor: page.nextCursor ?? null });
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load messages');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [chatId, accountId, authFetch, effectiveReloadToken]);

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
    for (const m of [...history, ...live]) {
      byId.set(m.id, mergeMessage(byId.get(m.id), m));
    }
    for (const m of optimistic) if (!byId.has(m.id)) byId.set(m.id, m);

    // Pin/like overrides land last, over whichever source won — see MessageFlags.
    for (const [id, flag] of Object.entries(flags)) {
      const existing = byId.get(id);
      if (existing) byId.set(id, { ...existing, ...flag });
    }

    return [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }, [history, live, optimistic, flags]);

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
    async (input: SendInput) => {
      const text = input.text.trim();
      const mediaIds = input.mediaIds ?? [];
      if (!chatId || (!text && mediaIds.length === 0) || sending) return false;
      // Cleared per attempt so a second identical failure still re-toasts — the
      // toast fires on a *change* of `error`.
      setError(null);
      const tempId = `pending-${Date.now()}`;
      setOptimistic((prev) => [
        ...prev,
        {
          id: tempId,
          chatId,
          text,
          createdAt: new Date().toISOString(),
          fromMe: true,
          price: input.price ?? 0,
          isTip: false,
          isOpened: false,
          // The placeholder counts the media but describes none of it. The
          // staged files exist only as local bytes and vault ids at this point;
          // the real attachments — with resolvable links — arrive on the send
          // response a moment later. A count renders as "2 attachments", which
          // is true, rather than as tiles that would have nothing to show.
          mediaCount: mediaIds.length,
          attachments: [],
          pending: true,
        },
      ]);
      setSending(true);
      try {
        const { message } = await authFetch(`/api/onlyfans/chats/${chatId}/messages`, {
          method: 'POST',
          body: JSON.stringify({
            text,
            replyToMessageId: input.replyToMessageId,
            mediaIds,
            previewIds: input.previewIds ?? [],
            price: input.price ?? 0,
            lockedText: input.lockedText ?? false,
          }),
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

  /**
   * Pin/unpin or like/unlike a message.
   *
   * Optimistic and **reverted on failure**, which is the opposite trade to a
   * failed send: there is no draft to hand back and nothing the operator must
   * re-type, so the honest thing is to put the flag back where the provider says
   * it is. The mutation reports its own outcome by returning false; the caller
   * toasts, because unlike a send the result is a single icon that is easy to
   * miss snapping back.
   */
  const setFlag = useCallback(
    async (messageId: string, flag: 'pinned' | 'liked', value: boolean) => {
      const key = flag === 'pinned' ? 'isPinned' : 'isLiked';
      // Read through a ref so this callback stays stable across every flag
      // change — it is handed to every bubble in the thread.
      const previous = flagsRef.current[messageId]?.[key];

      setFlags((prev) => ({ ...prev, [messageId]: { ...prev[messageId], [key]: value } }));

      try {
        await authFetch(`/api/onlyfans/chats/${chatId}/messages/${messageId}/${flag === 'pinned' ? 'pin' : 'like'}`, {
          method: value ? 'POST' : 'DELETE',
        });
        return true;
      } catch {
        setFlags((prev) => {
          const next = { ...prev, [messageId]: { ...prev[messageId], [key]: previous } };
          // An override that reverted to "no opinion" must be dropped, not kept
          // as `undefined` — the merge spreads it over the real row and would
          // blank a flag the provider actually reports.
          if (previous === undefined) delete next[messageId][key];
          return next;
        });
        return false;
      }
    },
    [authFetch, chatId],
  );

  /** Retry after a failed load, from the thread's own error state. */
  const reload = useCallback(() => setLocalReload((n) => n + 1), []);

  return {
    messages,
    loading,
    loadingOlder,
    hasMore,
    sending,
    error,
    loadOlder,
    send,
    setFlag,
    reload,
  };
}
