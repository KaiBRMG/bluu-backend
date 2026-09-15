'use client';

import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { getCache, setCache } from '@/lib/queryCache';
import type { Creator } from '@/lib/campaignTracking';

/**
 * The active creator list, as a **module-level shared store**.
 *
 * ## Why a store rather than per-hook state
 *
 * This used to hold its own `useState` + `useEffect` per call site, which was
 * fine when a page called it once. It is not fine now that `CreatorChip` calls
 * it: a month calendar renders thirty-odd chips, and each one was mounting its
 * own effect, reading `sessionStorage`, and `JSON.parse`-ing the whole creator
 * list — thirty parses and thirty subscriptions to produce the same array.
 *
 * With one store there is exactly **one** parse, **one** fetch (concurrent
 * mounts share the in-flight promise), and **one** array identity. Every
 * consumer reads the same snapshot, so adding a chip costs a render and nothing
 * else.
 *
 * `useSyncExternalStore` is the right primitive for this: no effect per
 * consumer, no cascading render on mount, and a snapshot React can rely on
 * being stable. `getSnapshot` therefore returns the *stored* array, never a new
 * one — returning a fresh `[]` or a `.filter()` here would make React loop.
 */

const CACHE_KEY = 'bluu_creators_v2';
const TTL = 5 * 60 * 1000;

/** Stable empty snapshot. A new `[]` per call would spin `useSyncExternalStore`. */
const EMPTY: Creator[] = [];

let snapshot: Creator[] = EMPTY;
let fetchedAt = 0;
let inFlight: Promise<void> | null = null;
let hydratedFromCache = false;

const listeners = new Set<() => void>();

/** Derived id→account index, rebuilt only when the snapshot itself changes. */
let indexSource: Creator[] = EMPTY;
let index: Map<string, Creator> = new Map();

/** Derived creators-only view, rebuilt on the same trigger. */
let creatorsOnlySource: Creator[] = EMPTY;
let creatorsOnly: Creator[] = EMPTY;

function emit(): void {
  for (const listener of listeners) listener();
}

function setSnapshot(next: Creator[]): void {
  snapshot = next;
  fetchedAt = Date.now();
  emit();
}

/**
 * Read the sessionStorage cache once per page load, not once per consumer.
 *
 * Runs at module init rather than on first subscribe, so the very first render
 * already sees the cached list. Hydrating inside `subscribe` would work —
 * React re-renders when the store changes between render and subscribe — but it
 * makes correctness depend on a subtlety of `useSyncExternalStore`, and the
 * first paint would flash empty avatars for a frame.
 *
 * Guarded on `window` because this module is also evaluated on the server during
 * SSR, where `sessionStorage` does not exist. `getCache` swallows that anyway;
 * the guard makes the intent explicit.
 */
function hydrate(): void {
  if (hydratedFromCache || typeof window === 'undefined') return;
  hydratedFromCache = true;

  const cached = getCache<Creator[]>(CACHE_KEY, TTL);
  if (cached) {
    snapshot = cached;
    fetchedAt = Date.now();
  }
}

hydrate();

/**
 * Fetch, unless a fresh snapshot is already in hand or a request is already out.
 *
 * The in-flight guard is what makes thirty simultaneous chip mounts cost one
 * request instead of thirty.
 */
function ensureLoaded(getToken: () => Promise<string>): void {
  if (inFlight) return;
  if (snapshot !== EMPTY && Date.now() - fetchedAt < TTL) return;

  inFlight = (async () => {
    try {
      const token = await getToken();
      const res = await fetch('/api/creators', { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return;

      const data = (await res.json()) as { creators?: Array<Creator & { isArchived?: boolean }> };

      // Employee-facing visibility is governed by `isArchived` only — an
      // inactive (portal-login-disabled) creator's data must still show here.
      const visible = (data.creators ?? []).filter(c => c.isArchived !== true);

      setCache(CACHE_KEY, visible);
      setSnapshot(visible);
    } catch {
      // A failed load leaves the previous snapshot in place. Creator names are
      // decoration on most surfaces; blanking them on a transient error would be
      // worse than showing slightly stale ones.
    } finally {
      inFlight = null;
    }
  })();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getIndex(): Map<string, Creator> {
  if (indexSource !== snapshot) {
    indexSource = snapshot;
    index = new Map(snapshot.map(creator => [creator.creatorID, creator]));
  }
  return index;
}

/**
 * Creators without their sub-accounts.
 *
 * Cached on the snapshot's identity rather than filtered per consumer: a fresh
 * `.filter()` inside `getSnapshot` returns a new array every call, which is the
 * one thing `useSyncExternalStore` cannot tolerate — it would re-render forever.
 */
function getCreatorsOnly(): Creator[] {
  if (creatorsOnlySource !== snapshot) {
    creatorsOnlySource = snapshot;
    const filtered = snapshot.filter(c => !c.isSubAccount);
    // Reuse the full snapshot when nothing was filtered, so the two views share
    // an identity for the (common) case of no sub-accounts at all.
    creatorsOnly = filtered.length === snapshot.length ? snapshot : filtered;
  }
  return creatorsOnly;
}

const getSnapshot = () => snapshot;
const getCreatorsOnlySnapshot = () => getCreatorsOnly();
const getIndexSnapshot = () => getIndex();
/** SSR: a stable empty index, for the same reason as the empty list. */
const EMPTY_INDEX: Map<string, Creator> = new Map();
const getServerIndexSnapshot = () => EMPTY_INDEX;
/** SSR has no creators and no sessionStorage; the stable empty list is correct. */
const getServerSnapshot = () => EMPTY;

/**
 * Creators, **without** their sub-accounts (5-min sessionStorage TTL).
 *
 * The default view, because most surfaces are about the creator as a brand — a
 * custom request, a campaign, a content plan are raised against Cole, not
 * against "Cole (Fansly)". Shift assignment wants the lot and uses
 * {@link useAssignableAccounts}.
 */
export function useCreators(): Creator[] {
  const { user } = useAuth();

  const creators = useSyncExternalStore(subscribe, getCreatorsOnlySnapshot, getServerSnapshot);

  // The one piece of per-consumer work left, and it is a guarded no-op after the
  // first: `ensureLoaded` returns immediately when the snapshot is fresh or a
  // request is already out. It never sets state synchronously — the store
  // updates from the resolved promise.
  useEffect(() => {
    if (user) ensureLoaded(() => user.getIdToken());
  }, [user]);

  return creators;
}

/**
 * Every assignable account — creators **and** their sub-accounts, grouped so
 * each creator is followed by its own.
 *
 * This is the list a shift assignment picker needs: a sub-account is a peer for
 * assignment and pay, and one agent can hold Cole while another holds
 * Cole (Fansly).
 */
export function useAssignableAccounts(): Creator[] {
  const { user } = useAuth();

  const accounts = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  useEffect(() => {
    if (user) ensureLoaded(() => user.getIdToken());
  }, [user]);

  return accounts;
}

/**
 * Every assignable account keyed by id — creators and sub-accounts both.
 *
 * For surfaces that look an id up rather than iterate: a chip resolving one, a
 * calendar cell resolving four. It must span both kinds, because
 * `shifts.creatorIds` does. The Map is memoised on the snapshot's identity, so
 * it is rebuilt when the list actually changes and shared by every consumer in
 * between.
 */
export function useCreatorMap(): Map<string, Creator> {
  const { user } = useAuth();

  const map = useSyncExternalStore(subscribe, getIndexSnapshot, getServerIndexSnapshot);

  useEffect(() => {
    if (user) ensureLoaded(() => user.getIdToken());
  }, [user]);

  return map;
}

/** Force a refetch — for a surface that has just changed the creator list. */
export function useRefreshCreators(): () => void {
  const { user } = useAuth();
  return useCallback(() => {
    if (!user) return;
    fetchedAt = 0;
    ensureLoaded(() => user.getIdToken());
  }, [user]);
}
