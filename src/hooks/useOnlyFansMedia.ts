'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuthFetch } from '@/hooks/useAuthFetch';
import type { OFMediaVariant } from '@/lib/onlyfans/types';

/**
 * Resolving OnlyFans media for display.
 *
 * A provider CDN link cannot be put in an `<img>`: `cdn*.onlyfans.com` is
 * IP-locked to the provider's proxy. Every attachment therefore goes through the
 * media routes, which hand back a URL the renderer can load — and **which the
 * provider bills by the megabyte the first time anyone asks for the file.** That
 * single fact shapes everything here:
 *
 *  - nothing resolves until it is on screen (`useResolvedMedia` is driven by an
 *    `enabled` flag the tile flips from an IntersectionObserver);
 *  - requests inside one tick are **coalesced into one batch**, so a message
 *    with four photos is one round trip;
 *  - answers are memoised **per `id:variant`**, not per URL.
 *
 * That last point is the fix for a quiet, recurring bill. The provider re-signs
 * its CDN links on every history fetch, so a URL-keyed cache missed on every
 * thread refresh and re-resolved every tile in the viewport even though not one
 * byte of the underlying media had changed. The media id is stable for the life
 * of the file, so keying on it means a refresh costs nothing.
 *
 * Large renditions (`full`, `video720`, `video240`) do not come through here —
 * see `useResolvedFile`. They are a single deliberate request with a much longer
 * budget, never a viewport-driven batch.
 */

/** Everything needed to ask for one rendition of one attachment. */
export interface MediaRef {
  /** The provider's media id. Stable; this is what the caches key on. */
  id: string;
  variant: OFMediaVariant;
  /**
   * The expiring source link, when the caller has one. Null is legitimate and
   * common: a message that arrived by webhook carries attachment metadata but no
   * URLs, because CDN links are deliberately never mirrored. The server can
   * still answer from its cache, which after the file's first sighting it
   * usually can.
   */
  url: string | null;
}

/** Distinguishes the outcomes a tile renders differently. */
export class MediaResolveError extends Error {
  constructor(readonly code: 'expired' | 'uncached' | 'failed') {
    super(
      code === 'expired'
        ? 'Media link expired'
        : code === 'uncached'
          ? 'Media is not cached yet'
          : 'Could not load media',
    );
    this.name = 'MediaResolveError';
  }
}

interface CacheEntry {
  url: string;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();
/** In-flight promises, so two tiles asking for the same file make one request. */
const inflight = new Map<string, Promise<string>>();

/** How long requests wait to be batched together. One animation frame's worth. */
const BATCH_WINDOW_MS = 30;
/** Must not exceed the route's own ceiling. */
const MAX_BATCH = 12;

export function mediaKey(ref: MediaRef): string {
  return `${ref.id}:${ref.variant}`;
}

type Pending = {
  ref: MediaRef;
  resolve: (url: string) => void;
  reject: (error: MediaResolveError) => void;
};

type AuthFetch = (url: string, options?: RequestInit) => Promise<{
  resolved?: Record<string, { url?: string; ttlMs?: number; error?: string }>;
}>;

const queue: Pending[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let queuedFetch: AuthFetch | null = null;

function toCode(value: string | undefined): 'expired' | 'uncached' | 'failed' {
  return value === 'expired' || value === 'uncached' ? value : 'failed';
}

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
        body: JSON.stringify({
          items: batch.map((b) => ({ id: b.ref.id, variant: b.ref.variant, url: b.ref.url })),
        }),
      });
      for (const item of batch) {
        const entry = body.resolved?.[mediaKey(item.ref)];
        if (entry?.url) {
          cache.set(mediaKey(item.ref), {
            url: entry.url,
            expiresAt: Date.now() + (entry.ttlMs ?? 30_000),
          });
          item.resolve(entry.url);
        } else {
          item.reject(new MediaResolveError(toCode(entry?.error)));
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
    (ref: MediaRef): Promise<string> => {
      const key = mediaKey(ref);

      const hit = cache.get(key);
      if (hit && hit.expiresAt > Date.now()) return Promise.resolve(hit.url);
      if (hit) cache.delete(key);

      const existing = inflight.get(key);
      if (existing) return existing;

      const promise = new Promise<string>((resolve, reject) => {
        queue.push({ ref, resolve, reject });
        queuedFetch = authFetch;
        if (timer === null) timer = setTimeout(flush, BATCH_WINDOW_MS);
      }).finally(() => {
        inflight.delete(key);
      });

      inflight.set(key, promise);
      return promise;
    },
    [authFetch],
  );
}

/**
 * The lazy gate every media tile is behind — thread and vault alike.
 *
 * It is a **cost control** before it is a performance one: the first fetch of a
 * file is billed, so a thread scrolled past or a vault grid opened and closed
 * must not pay for tiles nobody looked at. Latches on: once a tile has been
 * seen, scrolling it away does not un-resolve it.
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

export type MediaStatus = 'idle' | 'loading' | 'ready' | 'expired' | 'uncached' | 'error';

/**
 * Resolve one small rendition (`thumb` / `preview`) for display, but only once
 * `enabled` is true.
 *
 * `enabled` is the cost control: a tile passes `false` until it scrolls into
 * view, so opening a thread does not pay for media nobody looked at.
 *
 * `retry()` re-resolves. It is worth offering after a `failed` (transient), and
 * worth *not* offering after `expired` — an aged-out source link cannot be
 * revived, only replaced by refreshing the thread.
 */
export function useResolvedMedia(ref: MediaRef | null, enabled: boolean) {
  const resolveMedia = useResolveMedia();
  const [attempt, setAttempt] = useState(0);
  // The outcome is stamped with the request it answers, so `loading` can be
  // *derived* from "no outcome for the current request yet" rather than set at
  // the top of the effect. Setting it there would be a synchronous setState in
  // an effect body — a cascading render on every tile that enters the viewport.
  const [outcome, setOutcome] = useState<{
    key: string;
    url?: string;
    code?: 'expired' | 'uncached' | 'failed';
  } | null>(null);

  // Both primitives, so a caller may build the ref object inline every render.
  const refKey = ref ? mediaKey(ref) : '';
  const sourceUrl = ref?.url ?? null;
  const key = refKey === '' ? '' : `${attempt}#${refKey}`;

  // Guards a resolve that lands after the tile scrolled away and unmounted, and
  // after a `retry` supersedes an earlier attempt.
  const liveRef = useRef(0);

  useEffect(() => {
    if (!refKey || !enabled) return;

    const [id, variant] = splitKey(refKey);
    const ticket = ++liveRef.current;

    resolveMedia({ id, variant, url: sourceUrl })
      .then((resolved) => {
        if (liveRef.current === ticket) setOutcome({ key, url: resolved });
      })
      .catch((error: unknown) => {
        if (liveRef.current !== ticket) return;
        const code = error instanceof MediaResolveError ? error.code : 'failed';
        setOutcome({ key, code });
      });

    return () => {
      // Any in-flight answer for this tile is now stale.
      if (liveRef.current === ticket) liveRef.current += 1;
    };
  }, [refKey, sourceUrl, enabled, resolveMedia, key]);

  /**
   * Call when the element actually failed to load the resolved URL.
   *
   * This is the safety net that lets the cached-URL TTL be generous. Rather than
   * expiring entries early — which costs a fresh resolve for every tile the
   * operator scrolls back over — we assume they work and re-resolve exactly the
   * ones that turn out not to. Once, so a genuinely dead file settles into the
   * error state instead of looping.
   */
  const onLoadError = useCallback(() => {
    if (refKey) cache.delete(refKey);
    setAttempt((n) => (n === 0 ? 1 : n));
  }, [refKey]);

  const current = outcome?.key === key ? outcome : null;
  const status: MediaStatus = statusOf(!refKey || !enabled, current);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  return { url: current?.url ?? null, status, retry, onLoadError };
}

/**
 * Resolve one **large** rendition — a video file or a photo at source
 * resolution.
 *
 * Separate from `useResolvedMedia` because the cost and the timing are both an
 * order of magnitude different. The first request for a file streams it through
 * the server into our own storage, which for a source-resolution video can take
 * tens of seconds; every later request is a signed URL and is instant. `slow`
 * flips once the wait is long enough to be worth explaining to the operator.
 *
 * There is no batching and no viewport gate: this only ever runs because someone
 * pressed play or asked for full resolution.
 */
type FileFetch = (
  url: string,
  options?: RequestInit,
) => Promise<{ url?: string; ttlMs?: number; error?: string }>;

/**
 * One large-file request, cache first.
 *
 * Kept outside the hook so a cache hit is still delivered as a promise — the
 * effect must never call `setState` in its own body — and so two dialogs opened
 * on the same media share the in-flight request rather than each starting a
 * copy.
 */
function requestFile(
  authFetch: FileFetch,
  refKey: string,
  sourceUrl: string | null,
  refresh: boolean,
): Promise<string> {
  if (!refresh) {
    const hit = cache.get(refKey);
    if (hit && hit.expiresAt > Date.now()) return Promise.resolve(hit.url);
    if (hit) cache.delete(refKey);

    const existing = inflight.get(refKey);
    if (existing) return existing;
  }

  const [id, variant] = splitKey(refKey);
  const promise = authFetch('/api/onlyfans/media/file', {
    method: 'POST',
    // `refresh` only drops the server's memoised URL; it never re-downloads a
    // file already in the bucket, so a retry cannot re-bill.
    body: JSON.stringify({ id, variant, url: sourceUrl, refresh }),
  })
    .then((body) => {
      if (!body?.url) throw new MediaResolveError(toCode(body?.error));
      cache.set(refKey, { url: body.url, expiresAt: Date.now() + (body.ttlMs ?? 60_000) });
      return body.url;
    })
    .catch((error: unknown) => {
      if (error instanceof MediaResolveError) throw error;
      // `useAuthFetch` throws with the route's own `error` string as the
      // message, so the non-2xx codes arrive here verbatim.
      throw new MediaResolveError(toCode(error instanceof Error ? error.message : ''));
    })
    .finally(() => {
      inflight.delete(refKey);
    });

  inflight.set(refKey, promise);
  return promise;
}

export function useResolvedFile(ref: MediaRef | null, enabled: boolean) {
  const authFetch = useAuthFetch() as unknown as FileFetch;

  const [attempt, setAttempt] = useState(0);
  const [outcome, setOutcome] = useState<{
    key: string;
    url?: string;
    code?: 'expired' | 'uncached' | 'failed';
  } | null>(null);
  const [slow, setSlow] = useState(false);

  const refKey = ref ? mediaKey(ref) : '';
  const sourceUrl = ref?.url ?? null;
  const key = refKey === '' ? '' : `${attempt}#${refKey}`;
  const liveRef = useRef(0);

  useEffect(() => {
    if (!refKey || !enabled) return;

    const ticket = ++liveRef.current;
    const slowTimer = setTimeout(() => {
      if (liveRef.current === ticket) setSlow(true);
    }, 4000);

    // A cache hit still comes back through the promise rather than being applied
    // here. Resolving it inline would be a synchronous setState in an effect
    // body — a cascading render — and a microtask is indistinguishable to anyone
    // watching the dialog.
    requestFile(authFetch, refKey, sourceUrl, attempt > 0)
      .then((resolved) => {
        if (liveRef.current === ticket) setOutcome({ key, url: resolved });
      })
      .catch((error: unknown) => {
        if (liveRef.current !== ticket) return;
        const code = error instanceof MediaResolveError ? error.code : 'failed';
        setOutcome({ key, code });
      })
      .finally(() => {
        clearTimeout(slowTimer);
        if (liveRef.current === ticket) setSlow(false);
      });

    return () => {
      clearTimeout(slowTimer);
      if (liveRef.current === ticket) liveRef.current += 1;
    };
  }, [refKey, sourceUrl, enabled, authFetch, key, attempt]);

  const onLoadError = useCallback(() => {
    if (refKey) cache.delete(refKey);
    setAttempt((n) => (n === 0 ? 1 : n));
  }, [refKey]);

  const current = outcome?.key === key ? outcome : null;
  const status: MediaStatus = statusOf(!refKey || !enabled, current);

  return {
    url: current?.url ?? null,
    status,
    slow: slow && status === 'loading',
    retry: useCallback(() => setAttempt((n) => n + 1), []),
    onLoadError,
  };
}

function splitKey(key: string): [string, OFMediaVariant] {
  const at = key.lastIndexOf(':');
  return [key.slice(0, at), key.slice(at + 1) as OFMediaVariant];
}

function statusOf(
  idle: boolean,
  current: { url?: string; code?: 'expired' | 'uncached' | 'failed' } | null,
): MediaStatus {
  if (idle) return 'idle';
  if (!current) return 'loading';
  if (current.url) return 'ready';
  if (current.code === 'expired') return 'expired';
  if (current.code === 'uncached') return 'uncached';
  return 'error';
}
