/**
 * Client-side rate limiting for the BuddyX API — two token buckets per process.
 *
 * | Bucket | Limit | Drawn by |
 * |---|---|---|
 * | `global` | 120 / min | every request |
 * | `expensive` | 30 / min | `/team-reports/overview` and `/creators/earnings-breakdown`, **in addition to** `global` |
 *
 * The buckets are a courtesy, not the source of truth: every response's
 * `RateLimit-Remaining` / `RateLimit-Reset` headers resync the bucket the
 * request drew from, so a second process sharing the key (a manual refresh
 * racing the cron) is accounted for on the next response rather than
 * discovered as a 429. A 429 is still handled — by the client, which sleeps
 * `Retry-After` — but it should be rare.
 *
 * Requests are sequential (see `client.ts`), so the buckets never see
 * concurrent `take()` calls from one run.
 */

export type BucketName = 'global' | 'expensive';

interface Bucket {
  capacity: number;
  tokens: number;
  /** ms per token refilled. */
  refillMs: number;
  updatedAt: number;
}

const WINDOW_MS = 60_000;

function makeBucket(perMinute: number): Bucket {
  return { capacity: perMinute, tokens: perMinute, refillMs: WINDOW_MS / perMinute, updatedAt: Date.now() };
}

/** Module scope: one pair per serverless instance, which is one per run in practice. */
const buckets: Record<BucketName, Bucket> = {
  global: makeBucket(120),
  expensive: makeBucket(30),
};

/** The paths that also draw from the expensive bucket. */
const EXPENSIVE_PATHS = ['/v1/public/team-reports/overview', '/v1/public/creators/earnings-breakdown'];

export function bucketsFor(path: string): BucketName[] {
  return EXPENSIVE_PATHS.includes(path) ? ['global', 'expensive'] : ['global'];
}

function refill(bucket: Bucket, now: number): void {
  const elapsed = now - bucket.updatedAt;
  if (elapsed <= 0) return;
  bucket.tokens = Math.min(bucket.capacity, bucket.tokens + elapsed / bucket.refillMs);
  bucket.updatedAt = now;
}

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/** Wait until every named bucket has a token, then take one from each. */
export async function take(names: BucketName[]): Promise<void> {
  for (;;) {
    const now = Date.now();
    let waitMs = 0;
    for (const name of names) {
      const bucket = buckets[name];
      refill(bucket, now);
      if (bucket.tokens < 1) waitMs = Math.max(waitMs, (1 - bucket.tokens) * bucket.refillMs);
    }
    if (waitMs === 0) {
      for (const name of names) buckets[name].tokens -= 1;
      return;
    }
    await sleep(Math.ceil(waitMs));
  }
}

/**
 * Resync a bucket from the server's own headers.
 *
 * `RateLimit-Reset` is seconds until the window resets (RFC draft). The
 * remaining count is authoritative; we only ever lower our own estimate to it,
 * never raise above what our refill arithmetic allows — a header from a
 * different bucket (the expensive endpoints report the tighter one) must not
 * hand the global bucket tokens it does not have.
 */
export function resync(names: BucketName[], headers: Headers): void {
  const remaining = Number(headers.get('ratelimit-remaining'));
  const limit = Number(headers.get('ratelimit-limit'));
  if (!Number.isFinite(remaining)) return;

  // The tighter bucket is the one the server reported on.
  const name: BucketName =
    names.includes('expensive') && Number.isFinite(limit) && limit <= buckets.expensive.capacity ? 'expensive' : 'global';
  const bucket = buckets[name];
  refill(bucket, Date.now());
  bucket.tokens = Math.min(bucket.tokens, Math.max(0, remaining));
}

/** For a 429: drain the buckets so the next `take()` waits too. */
export function drain(names: BucketName[]): void {
  for (const name of names) buckets[name].tokens = 0;
}
