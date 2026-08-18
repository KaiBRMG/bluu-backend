/**
 * The OnlyFans media byte cache — server only.
 *
 * ## Why this exists
 *
 * The provider bills a media download at roughly **3 credits per megabyte, with
 * a 1-credit floor**, and it bills on the *bytes*, not on our API call: its
 * download endpoint answers a 302 to either `cdn.fansapi.com` (its own cache,
 * free) or `dl.fansapi.com`, "which streams it through the account proxy and
 * reports billing back to the API". Whoever fetches that second URL pays.
 *
 * Before this file existed, the thing that fetched it was the **operator's
 * browser**, once per view. That made the cost model *per view of a file* — so
 * the same 220MB video watched twice cost twice, a thread refreshed re-billed
 * every tile in it (the signed source URLs change, which busted every cache we
 * had), and a `<video>` element seeking through a clip issued a fresh range
 * request against the metered proxy on every scrub.
 *
 * This makes the cost model **per file, once, ever**. A billed stream happens
 * exactly one time, server-side, into our own bucket; every later view — by any
 * operator, on any day — is a signed URL into Cloud Storage.
 *
 * ## The invariant
 *
 * **A billed provider URL is never handed to the renderer.** `resolveMediaUrl`
 * on the adapter reports `billed` for exactly this purpose, and this module is
 * the only sanctioned consumer of a billed URL. If the copy into Storage fails
 * we return an error rather than falling back to the provider link: the fallback
 * looks like a kindness and is actually an uncapped bill, because nothing
 * downstream limits how many times a browser will re-fetch it.
 *
 * ## What is *not* cached
 *
 * A resolve that lands on the provider's free CDN is passed straight through for
 * small variants — copying it would add latency to a tile's first paint to save
 * nothing. Large variants are copied either way, because "free right now" is a
 * statement about their cache today, and re-streaming a 200MB file after it ages
 * out of that cache is the expensive mistake this file exists to prevent.
 */
import { Readable, Transform } from 'stream';
import { pipeline } from 'stream/promises';
import { adminStorage } from '@/lib/firebase-admin';
import { getOnlyFansClient } from '@/lib/onlyfans';
import { OnlyFansApiError, type OFMediaVariant } from '@/lib/onlyfans/types';

/** Where cached media lives. Kept out of `onlyfans-outgoing/`, which is transient. */
export const OF_MEDIA_CACHE_PREFIX = 'onlyfans-media';

/**
 * How long a signed read URL is good for.
 *
 * A v4 signed URL is a bearer token for a fan's private media, so this is short
 * rather than the 7-day maximum. It costs nothing to re-sign: v4 signing is a
 * local HMAC against the service-account key, not a call to Google.
 */
const SIGNED_URL_TTL_MS = 6 * 60 * 60 * 1000;

/** Re-sign a little before expiry rather than handing out a URL about to die. */
const SIGN_SLACK_MS = 10 * 60 * 1000;

/** Bounds the memo. Signed URLs are long strings; an unbounded map is a leak. */
const MEMO_MAX = 2000;

/**
 * Ceiling on one cached object. Well past any legitimate attachment (the largest
 * seen in billing was 223MB) and low enough that a runaway response cannot fill
 * the bucket or hang the function for its whole duration budget.
 */
const MAX_CACHE_BYTES = 750 * 1024 * 1024;

/** Content types we will serve back. Anything else is not media we render. */
const CACHEABLE_TYPE = /^(image|video|audio)\//i;

interface MemoEntry {
  url: string;
  expiresAt: number;
}

const memo = new Map<string, MemoEntry>();

/**
 * In-flight work, so two tiles — or two operators in the same lambda — asking
 * for one file produce one billed stream rather than two.
 */
const inflight = new Map<string, Promise<ResolvedVariant>>();

export interface ResolvedVariant {
  url: string;
  ttlMs: number;
  /**
   * Where the URL points, for logging and for the caller's own decisions.
   * `cache` and `stored` are ours and free to re-fetch; `provider` is the
   * provider's free CDN and expires quickly.
   */
  source: 'cache' | 'stored' | 'provider';
}

/** Raised when there is nothing to show and no way to get it. */
export class MediaNotCachedError extends Error {
  constructor() {
    super('Media is not cached and no source URL was supplied');
    this.name = 'MediaNotCachedError';
  }
}

/**
 * Object name for one rendition.
 *
 * Keyed on the **media id and variant**, never on the source URL. That is the
 * whole point: the provider re-signs its CDN links on every history fetch, so a
 * URL-keyed cache misses on every thread refresh while the underlying file has
 * not changed. The id is stable for the life of the media.
 */
function objectPath(accountId: string, mediaId: string, variant: OFMediaVariant): string {
  return `${OF_MEDIA_CACHE_PREFIX}/${accountId}/${mediaId}/${variant}`;
}

function memoKey(accountId: string, mediaId: string, variant: OFMediaVariant): string {
  return `${accountId}:${mediaId}:${variant}`;
}

function remember(key: string, url: string, ttlMs: number): void {
  if (memo.size >= MEMO_MAX) {
    // Insertion-ordered, so the first key is the oldest.
    const oldest = memo.keys().next().value;
    if (oldest !== undefined) memo.delete(oldest);
  }
  memo.set(key, { url, expiresAt: Date.now() + ttlMs });
}

/**
 * Sign a read URL for an object we believe exists. Purely local work — no
 * network — so this is cheap enough to do per tile per lambda.
 */
async function sign(path: string): Promise<string> {
  const [url] = await adminStorage
    .bucket()
    .file(path)
    .getSignedUrl({ version: 'v4', action: 'read', expires: Date.now() + SIGNED_URL_TTL_MS });
  return url;
}

/**
 * Fails the copy if the response outgrows the ceiling.
 *
 * `content-length` is checked first but is only a claim, and a chunked response
 * carries none at all. Counting the bytes as they pass is the part that actually
 * holds — without it an unbounded response would fill the bucket and hold the
 * function open for its entire duration budget.
 */
function capped(limit: number): Transform {
  let seen = 0;
  return new Transform({
    transform(chunk, _encoding, done) {
      seen += chunk.length;
      if (seen > limit) {
        done(new OnlyFansApiError(`Media exceeded ${limit} bytes while streaming`, 502));
        return;
      }
      done(null, chunk);
    },
  });
}

/**
 * Stream the provider's bytes into our bucket.
 *
 * Either way GCS finalises **no object at all** when the copy fails, so a
 * half-written file can never be served and there is nothing to clean up. The
 * choice between the two upload modes is Google's own guidance: a single-request
 * upload for small objects, resumable above a few megabytes, where a dropped
 * connection partway through a few hundred megabytes is worth surviving.
 */
async function copyIntoBucket(
  sourceUrl: string,
  path: string,
  variant: OFMediaVariant,
  large: boolean,
): Promise<string> {
  const response = await fetch(sourceUrl, { cache: 'no-store' });
  if (!response.ok || !response.body) {
    throw new OnlyFansApiError(
      `Media stream failed (${response.status}) while caching ${variant}`,
      response.status === 403 ? 403 : 502,
    );
  }

  const contentType = response.headers.get('content-type')?.split(';')[0]?.trim() ?? '';
  if (!CACHEABLE_TYPE.test(contentType)) {
    throw new OnlyFansApiError(`Refusing to cache non-media content type "${contentType}"`, 502);
  }

  const declared = Number(response.headers.get('content-length') ?? 0);
  if (declared > MAX_CACHE_BYTES) {
    throw new OnlyFansApiError(`Media is too large to cache (${declared} bytes)`, 502);
  }

  const file = adminStorage.bucket().file(path);
  await pipeline(
    Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]),
    capped(MAX_CACHE_BYTES),
    file.createWriteStream({
      resumable: large,
      contentType,
      // Our own objects, fetched by signed URL. The URL rotates well before this
      // does, so a long browser cache is free repeat views rather than a risk.
      metadata: { cacheControl: 'private, max-age=21600' },
    }),
  );

  return sign(path);
}

/**
 * Resolve one attachment variant into something a browser can load, paying the
 * provider at most once per file for the life of the bucket.
 *
 * `sourceUrl` is the expiring `cdn*.onlyfans.com` link off the message payload.
 * It may be null — a message that arrived by webhook carries attachment metadata
 * but no URLs, because CDN links are never mirrored. In that case this answers
 * only if the file is already cached, which after the first sighting it usually
 * is. That is a behaviour change worth knowing about: live messages used to show
 * a grey "Photo" placeholder until the thread was refreshed, and now they render
 * whenever the media has been seen before.
 *
 * Throws `MediaNotCachedError` when there is nothing cached and no source, and
 * `OnlyFansApiError` for provider and storage failures.
 */
export async function resolveMediaVariant(opts: {
  accountId: string;
  mediaId: string;
  variant: OFMediaVariant;
  sourceUrl: string | null;
  /** Large variants are always cached, never passed through. */
  large: boolean;
}): Promise<ResolvedVariant> {
  const { accountId, mediaId, variant, sourceUrl, large } = opts;
  const key = memoKey(accountId, mediaId, variant);

  const hit = memo.get(key);
  if (hit && hit.expiresAt > Date.now()) {
    return { url: hit.url, ttlMs: hit.expiresAt - Date.now(), source: 'cache' };
  }
  if (hit) memo.delete(key);

  const existing = inflight.get(key);
  if (existing) return existing;

  const work = (async (): Promise<ResolvedVariant> => {
    const path = objectPath(accountId, mediaId, variant);

    // One HEAD against GCS. Free, ~20ms, and it is what lets a cold lambda serve
    // media that another lambda paid for weeks ago.
    const [exists] = await adminStorage.bucket().file(path).exists();
    if (exists) {
      const url = await sign(path);
      remember(key, url, SIGNED_URL_TTL_MS - SIGN_SLACK_MS);
      return { url, ttlMs: SIGNED_URL_TTL_MS - SIGN_SLACK_MS, source: 'cache' };
    }

    if (!sourceUrl) throw new MediaNotCachedError();

    const resolved = await getOnlyFansClient().resolveMediaUrl(accountId, sourceUrl);

    // The metering line asked for in the cost review. One structured record per
    // resolve that reached the provider, which is what makes the billed-vs-free
    // split answerable from the logs instead of from the provider's dashboard.
    console.info(
      `[onlyfans:media] ${JSON.stringify({
        mediaId,
        variant,
        billed: resolved.billed,
        cached: resolved.billed || large,
      })}`,
    );

    if (!resolved.billed && !large) {
      // Free and small: hand it over as-is. Copying would cost a tile's first
      // paint to save nothing.
      remember(key, resolved.url, resolved.ttlMs);
      return { url: resolved.url, ttlMs: resolved.ttlMs, source: 'provider' };
    }

    // Everything else gets copied. A billed URL must not reach the renderer, and
    // a large free one is only free until their cache drops it.
    const url = await copyIntoBucket(resolved.url, path, variant, large);
    remember(key, url, SIGNED_URL_TTL_MS - SIGN_SLACK_MS);
    return { url, ttlMs: SIGNED_URL_TTL_MS - SIGN_SLACK_MS, source: 'stored' };
  })().finally(() => {
    inflight.delete(key);
  });

  inflight.set(key, work);
  return work;
}

/**
 * Drop a memoised URL. Called when the renderer reports that a URL it was given
 * would not load, so the next request re-signs (or re-fetches) rather than
 * handing back the same dead link.
 */
export function invalidateMediaVariant(
  accountId: string,
  mediaId: string,
  variant: OFMediaVariant,
): void {
  memo.delete(memoKey(accountId, mediaId, variant));
}
