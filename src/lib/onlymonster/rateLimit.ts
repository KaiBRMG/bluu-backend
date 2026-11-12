/**
 * Client-side rate limiting for the OnlyMonster API (om-api-service v0.77.0).
 *
 * | Bucket | Limit | Drawn by |
 * |---|---|---|
 * | `token` | 25 / s | every request |
 * | per endpoint | 15 / s default; overrides below | requests to that endpoint, **in addition to** `token` |
 *
 * The per-platform-account limit (1 / s on `/proxy/*` and the chat endpoints)
 * is not modelled: the client never calls those (see `client.ts`), and the
 * payout reads planned for Phase 7 get their own module.
 *
 * Requests are sequential, so `take()` is never called concurrently within a
 * run. A 429 is still handled by the client (it sleeps `Retry-After`).
 */

interface Bucket {
  capacity: number;
  tokens: number;
  refillMs: number;
  updatedAt: number;
}

function makeBucket(perSecond: number): Bucket {
  return { capacity: perSecond, tokens: perSecond, refillMs: 1000 / perSecond, updatedAt: Date.now() };
}

const TOKEN_PER_SECOND = 25;
const DEFAULT_ENDPOINT_PER_SECOND = 15;

/** Endpoint limits that differ from the default, per the spec's descriptions. */
const ENDPOINT_OVERRIDES: Array<{ pattern: RegExp; perSecond: number }> = [
  { pattern: /^\/api\/v0\/accounts\/[^/]+\/mass-messages$/, perSecond: 5 },
];

const tokenBucket = makeBucket(TOKEN_PER_SECOND);
const endpointBuckets = new Map<string, Bucket>();

/** The bucket key for a path: its shape, with ids replaced, so every account shares one endpoint bucket. */
export function endpointKey(path: string): string {
  return path.replace(/\/\d+(?=\/|$)/g, '/:id');
}

function bucketFor(path: string): Bucket {
  const key = endpointKey(path);
  let bucket = endpointBuckets.get(key);
  if (!bucket) {
    const override = ENDPOINT_OVERRIDES.find(o => o.pattern.test(path));
    bucket = makeBucket(override?.perSecond ?? DEFAULT_ENDPOINT_PER_SECOND);
    endpointBuckets.set(key, bucket);
  }
  return bucket;
}

function refill(bucket: Bucket, now: number): void {
  const elapsed = now - bucket.updatedAt;
  if (elapsed <= 0) return;
  bucket.tokens = Math.min(bucket.capacity, bucket.tokens + elapsed / bucket.refillMs);
  bucket.updatedAt = now;
}

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/** Wait until both the token bucket and the endpoint's bucket have a token, then take one from each. */
export async function take(path: string): Promise<void> {
  const buckets = [tokenBucket, bucketFor(path)];
  for (;;) {
    const now = Date.now();
    let waitMs = 0;
    for (const b of buckets) {
      refill(b, now);
      if (b.tokens < 1) waitMs = Math.max(waitMs, (1 - b.tokens) * b.refillMs);
    }
    if (waitMs === 0) {
      for (const b of buckets) b.tokens -= 1;
      return;
    }
    await sleep(Math.ceil(waitMs));
  }
}

/** For a 429: drain both buckets so the next `take()` waits too. */
export function drain(path: string): void {
  tokenBucket.tokens = 0;
  bucketFor(path).tokens = 0;
}
