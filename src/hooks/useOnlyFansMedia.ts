'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuthFetch } from '@/hooks/useAuthFetch';

/**
 * Resolving OnlyFans media for display.
 *
 * A provider CDN link cannot be put in an `<img>`: `cdn*.onlyfans.com` is
 * IP-locked to the provider's proxy. Every attachment therefore goes through
 * `POST /api/onlyfans/media/resolve`, which hands back a URL the renderer can
 * load — and **which the provider bills for when the file is not already
 * cached.** That single fact shapes everything here:
 *
 *  - nothing resolves until it is on screen (`useResolvedMedia` is driven by an
 *    `enabled` flag the tile flips from an IntersectionObserver);
 *  - requests inside one tick are **coalesced into one batch**, so a message
 *    with four photos is one round trip;
 *  - answers are memoised per URL for as long as the server says they are good,
 *    so scrolling back over a thread re-renders for free.
 *
 * The memo is module-level and in-memory on purpose. Resolved URLs are worth
 * under a minute; writing them to `sessionStorage` would persist links that are
 * dead by the time anything reads them back.
 */

/** Distinguishes "this link aged out" from "the request failed", which read differently. */
export class MediaResolveError extends Error {
  constructor(readonly code: 'expired' | 'failed') {
    super(code === 'expired' ? 'Media link expired' : 'Could not load media');
    this.name = 'MediaResolveError';
  }
}

interface CacheEntry {
  url: string;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();
/** In-flight promises, so two tiles asking for the same URL make one request. */
const inflight = new Map<string, Promise<string>>();

/** How long requests wait to be batched together. One animation frame's worth. */
const BATCH_WINDOW_MS = 30;
/** Must not exceed the route's own ceiling. */
const MAX_BATCH = 12;

type Pending = {
  url: string;
  resolve: (url: string) => void;
  reject: (error: MediaResolveError) => void;
};

type AuthFetch = (url: string, options?: RequestInit) => Promise<{
  resolved?: Record<string, { url?: string; ttlMs?: number; error?: string }>;
}>;

const queue: Pending[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let queuedFetch: AuthFetch | null = null;

function flush(): void {
  timer = null;
  const batch = queue.splice(0, MAX_BATCH);
  const authFetch = queuedFetch;
  if (batch.length === 0) return;

  // Anything over the ceiling goes out in the next window rather than being
  // dropped or splitting into an unbounded fan-out of requests.
  if (queue.length > 0 && timer === null) timer = setTimeout(flush, BATCH_WINDOW_MS);

  if (!authFetch) {
    for (const item of batch) item.reject(new MediaResolveError('failed'));
    return;
  }

  (async () => {
    try {
      const body = await authFetch('/api/onlyfans/media/resolve', {
        method: 'POST',
        body: JSON.stringify({ urls: batch.map((b) => b.url) }),
      });
      for (const item of batch) {
        const entry = body.resolved?.[item.url];
        if (entry?.url) {
          cache.set(item.url, {
            url: entry.url,
            expiresAt: Date.now() + (entry.ttlMs ?? 30_000),
          });
          item.resolve(entry.url);
        } else {
          item.reject(new MediaResolveError(entry?.error === 'expired' ? 'expired' : 'failed'));
        }
      }
    } catch {
      for (const item of batch) item.reject(new MediaResolveError('failed'));
    }
  })();
}

/**
 * Imperative resolve. Returns a browser-loadable URL, or throws
 * `MediaResolveError`. Prefer `useResolvedMedia` in components — it owns the
 * lazy gate and the unmount handling.
 */
export function useResolveMedia() {
  const authFetch = useAuthFetch() as unknown as AuthFetch;

  return useCallback(
    (cdnUrl: string): Promise<string> => {
      const hit = cache.get(cdnUrl);
      if (hit && hit.expiresAt > Date.now()) return Promise.resolve(hit.url);
      if (hit) cache.delete(cdnUrl);

      const existing = inflight.get(cdnUrl);
      if (existing) return existing;

      const promise = new Promise<string>((resolve, reject) => {
        queue.push({ url: cdnUrl, resolve, reject });
        queuedFetch = authFetch;
        if (timer === null) timer = setTimeout(flush, BATCH_WINDOW_MS);
      }).finally(() => {
        inflight.delete(cdnUrl);
      });

      inflight.set(cdnUrl, promise);
      return promise;
    },
    [authFetch],
  );
}

/**
 * The lazy gate every media tile is behind — thread and vault alike.
 *
 * It is a **cost control** before it is a performance one: resolving a URL is
 * billed when the provider has not cached the file, so a thread scrolled past or
 * a vault grid opened and closed must not pay for tiles nobody looked at. Latches
 * on: once a tile has been seen, scrolling it away does not un-resolve it.
 */
export function useInViewport<T extends HTMLElement>(margin = '200px') {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || inView) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setInView(true);
      },
      // A little ahead of the fold, so a tile is usually ready by the time it
      // arrives rather than resolving under the operator's eyes.
      { rootMargin: margin },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [inView, margin]);

  return { ref, inView };
}

export type MediaStatus = 'idle' | 'loading' | 'ready' | 'expired' | 'error';

/**
 * Resolve one CDN URL for display, but only once `enabled` is true.
 *
 * `enabled` is the cost control: a tile passes `false` until it scrolls into
 * view, so opening a thread does not bill for media nobody looked at.
 *
 * `retry()` re-resolves the same URL. It is worth offering after a `failed`
 * (transient), and worth *not* offering after `expired` — an aged-out link
 * cannot be revived, only replaced by refreshing the thread.
 */
export function useResolvedMedia(cdnUrl: string | null, enabled: boolean) {
  const resolveMedia = useResolveMedia();
  const [attempt, setAttempt] = useState(0);
  // The outcome is stamped with the request it answers, so `loading` can be
  // *derived* from "no outcome for the current request yet" rather than set at
  // the top of the effect. Setting it there would be a synchronous setState in
  // an effect body — a cascading render on every tile that enters the viewport.
  const [outcome, setOutcome] = useState<{
    key: string;
    url?: string;
    code?: 'expired' | 'failed';
  } | null>(null);

  const key = cdnUrl === null ? '' : `${attempt}#${cdnUrl}`;

  // Guards a resolve that lands after the tile scrolled away and unmounted, and
  // after a `retry` supersedes an earlier attempt.
  const liveRef = useRef(0);

  useEffect(() => {
    if (!cdnUrl || !enabled) return;

    const ticket = ++liveRef.current;

    resolveMedia(cdnUrl)
      .then((resolved) => {
        if (liveRef.current === ticket) setOutcome({ key, url: resolved });
      })
      .catch((error: unknown) => {
        if (liveRef.current !== ticket) return;
        const expired = error instanceof MediaResolveError && error.code === 'expired';
        setOutcome({ key, code: expired ? 'expired' : 'failed' });
      });

    return () => {
      // Any in-flight answer for this tile is now stale.
      if (liveRef.current === ticket) liveRef.current += 1;
    };
  }, [cdnUrl, enabled, resolveMedia, key]);

  /**
   * Call when the element actually failed to load the resolved URL.
   *
   * This is the safety net that lets the resolved-URL TTL be generous. Rather
   * than expiring cached links early — which bills a fresh resolve for every
   * tile the operator scrolls back over — we assume they work and re-resolve
   * exactly the ones that turn out not to. Once, so a genuinely dead file
   * settles into the error state instead of looping.
   */
  const onLoadError = useCallback(() => {
    if (cdnUrl) cache.delete(cdnUrl);
    setAttempt((n) => (n === 0 ? 1 : n));
  }, [cdnUrl]);

  const current = outcome?.key === key ? outcome : null;
  const status: MediaStatus =
    !cdnUrl || !enabled
      ? 'idle'
      : !current
        ? 'loading'
        : current.url
          ? 'ready'
          : current.code === 'expired'
            ? 'expired'
            : 'error';

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  return { url: current?.url ?? null, status, retry, onLoadError };
}
