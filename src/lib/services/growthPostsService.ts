/**
 * Growth Tracking — post analytics. The only module that talks to the tweet
 * scraper (`kaitoeasyapi/twitter-x-data-tweet-scraper-pay-per-result-cheapest`).
 *
 * ═══ COST IS THE GOVERNING CONSTRAINT — read this before changing anything ═══
 *
 * This actor bills **per returned result** — $0.25 per 1,000, so $0.00025 each.
 * The request is not the billed unit: filling a call with 1,000 ids does not
 * amortise anything, it buys 1,000 readings and charges for 1,000 readings.
 *
 * Seven rules keep this feature at roughly $1–3/month. Every one of them is easy
 * to undo by accident, and each is written as an assertion in the code below
 * rather than left to a default.
 *
 *  1. **`maxItems` DOES NOT CAP THIS ACTOR'S BILL.** Its minimum is 20 and it
 *     "defines the minimum number of items to return, not a strict limit" —
 *     results may exceed it. This is the exact opposite of
 *     `apidojo/twitter-user-scraper` in growthTrackingService.ts, where
 *     `maxItems` IS the ceiling. Do not carry that assumption across. The bill
 *     here is capped by INPUT SIZE: `searchTerms.length` and `tweetIDs.length`.
 *  2. **Two call shapes, and the difference between them is the whole design.**
 *     Search (`from:handle`) DISCOVERS posts and pays a 20-result floor per
 *     term. Id lookup (`tweetIDs`) REFRESHES known posts and pays for what it
 *     asks. Never one call per post; never one call per account.
 *  3. **Never send a batch under `MIN_BILLED_RESULTS`.** The floor is billed
 *     either way, so a 6-id refresh is padded to 20 with the stalest tracked
 *     posts — turning wasted floor into free readings. Equally, never pad past
 *     what is due: every extra id is real money spent on a number nobody asked
 *     for.
 *  4. **A discovery result is also a reading.** The engagement numbers ride
 *     inside the same billed result as the post text, so a post inside an
 *     account's newest-20 window is refreshed by the nightly discovery pass for
 *     free and must not also be sent to the id batch. Recording any reading
 *     advances `nextRefreshAt`, which is what makes that automatic.
 *  5. **Zero-result responses are filled with MOCK DATA and still billed.** The
 *     vendor documents this. Every returned item is therefore reconciled against
 *     what was requested — by id for a lookup, by author handle for a discovery
 *     — and anything unmatched is dropped and logged, never stored. Without this
 *     the feature writes invented engagement numbers onto a page whose governing
 *     rule is that nothing may invent a value.
 *  6. **Two circuit breakers, because one is not enough.** `MAX_TRACKED_POSTS`
 *     bounds the roster, and the `growth-spend` ledger bounds the money — post
 *     volume, not post count, drives this bill, and an account going viral is a
 *     cost event nobody authorised.
 *  7. **NEVER call this API by hand** (cross-cutting rule 9d). Doubly so here:
 *     an exploratory call that returns nothing still bills, and hands back mock
 *     data that could be mistaken for a real payload. Every field below is
 *     probed defensively across plausible spellings for exactly that reason —
 *     the payload shape has been read from documentation, not observed.
 *
 * The existing follower scrape in `growthTrackingService.ts` is untouched by all
 * of this and keeps its own actors, its own cadence and its own cost line.
 */

import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { serializeTimestamp } from '@/lib/middleware/apiHelpers';
import {
  GROWTH_ACCOUNTS,
  GROWTH_SERIES_SUB,
  runApifyActor,
  apifyNum,
  apifyStr,
} from '@/lib/services/growthTrackingService';
import { postUrlFor } from '@/lib/growth/postLink';
import { refreshIntervalHours, snapshotKey } from '@/lib/growth/postMetrics';
import { growthAccountId, seriesDocIdFor, utcDayKey } from '@/lib/growth/platform';
import type {
  GrowthPost,
  GrowthPostMedia,
  GrowthPostSnapshot,
  GrowthPostSource,
  GrowthSpendLedger,
  GrowthSnapshot,
} from '@/types/firestore';
import type { DocumentSnapshot } from 'firebase-admin/firestore';

// ─── Collections ─────────────────────────────────────────────────────

export const GROWTH_POSTS = 'growth-posts';
export const GROWTH_SPEND = 'growth-spend';

const TWEET_ACTOR = 'kaitoeasyapi~twitter-x-data-tweet-scraper-pay-per-result-cheapest';

// ─── Cost constants ──────────────────────────────────────────────────

/** $0.25 per 1,000 results. The store page advertises $0.18; plan on the worse. */
export const UNIT_COST_PER_RESULT = 0.00025;

/**
 * The actor's `maxItems` minimum, and therefore the floor a call is billed at
 * whatever it actually returns. Batches are padded up to this and never sent
 * below it — see rule 3.
 */
export const MIN_BILLED_RESULTS = 20;

/** Results requested per search term during discovery. The floor; cannot go lower. */
export const DISCOVERY_MAX_ITEMS = 20;

/**
 * Circuit breaker on the roster. Mirrors `MAX_TRACKED_ACCOUNTS`. Past this the
 * add route refuses with an explanation rather than quietly widening the bill.
 */
export const MAX_TRACKED_POSTS = 300;

/**
 * Circuit breaker on a single refresh cycle. Bounds the worst case at
 * 200 × $0.00025 = $0.05 per run, whatever the roster has grown to.
 */
export const MAX_REFRESH_PER_RUN = 200;

/**
 * Circuit breaker on the money. The rolling monthly ledger is the only one of
 * the three that catches volume nobody chose — a tracked account posting sixty
 * times a day passes every count-based check while multiplying the bill.
 */
export const MONTHLY_SPEND_CEILING_USD = 15;

/**
 * Server-enforced manual-sync cooldown, re-exported from the pure module so the
 * UI's "disabled for another 6 minutes" and this route's 429 can never disagree.
 */
export { MANUAL_SYNC_COOLDOWN_MS } from '@/lib/growth/postMetrics';

/** Post text is truncated on write — the link is the source of truth. */
const TEXT_MAX = 500;

/**
 * Hard cap on stored readings per post. The ladder puts a post at ~15 readings
 * over its whole life, so this is only ever reached through repeated manual
 * syncs. Pruning happens during a write the caller already holds the document
 * for, so it costs nothing.
 */
const HISTORY_MAX_POINTS = 400;

/**
 * `nextRefreshAt` for a frozen post. A sentinel rather than `null` because a
 * null sorts *before* every timestamp in Firestore, so a null would make frozen
 * posts the first thing every "what is due?" query returned.
 */
const FROZEN_REFRESH_AT = new Date('9999-01-01T00:00:00Z');

/**
 * Sanity band for a post-derived follower count, as a multiple of the account's
 * last known value.
 *
 * Deliberately loose. Its job is to catch a parse error or a mock-data row that
 * slipped the handle reconciliation — **not** to second-guess real growth. An
 * account genuinely doubling overnight passes; one reporting ten times or a
 * tenth of yesterday did not grow, it broke. A rejected value is logged and
 * skipped, and the nightly profile scrape still supplies that day's number, so
 * the failure mode is "no fresher than before" rather than a corrupted series.
 */
const FOLLOWER_SANITY_MULTIPLE = 10;

// ─── Scraped shape ───────────────────────────────────────────────────

/** One post as returned by the actor, after defensive parsing. */
export interface ScrapedPost {
  tweetId: string;
  url: string;
  text: string;
  lang: string | null;
  postedAt: Date | null;
  isReply: boolean;
  isQuote: boolean;
  isRetweet: boolean;
  conversationId: string | null;
  media: GrowthPostMedia[];
  authorHandle: string | null;
  authorHandleNormalized: string | null;
  authorName: string | null;
  authorProfilePictureUrl: string | null;
  authorIsVerified: boolean;
  snapshot: GrowthPostSnapshot;
}

/** First defined value across several plausible spellings of one field. */
function pick(item: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (item[key] !== undefined && item[key] !== null) return item[key];
  }
  return undefined;
}

function pickNum(item: Record<string, unknown>, keys: string[]): number | undefined {
  return apifyNum(pick(item, keys));
}

function pickStr(item: Record<string, unknown>, keys: string[]): string | null {
  return apifyStr(pick(item, keys));
}

/**
 * Parse one dataset item into a post, or `null` if it is not one.
 *
 * Every field is probed across the spellings the actor's documentation and the
 * underlying X payloads both use (`likeCount` vs `favorite_count`, `author` vs
 * `user`, and so on). That is not defensiveness for its own sake: rule 9d
 * forbids calling the API to observe the real shape, so the parser has to
 * tolerate being wrong about it rather than silently drop a metric.
 */
export function parseScrapedPost(item: Record<string, unknown>): ScrapedPost | null {
  const tweetId = pickStr(item, ['id', 'id_str', 'tweetId', 'rest_id']);
  if (!tweetId || !/^\d{8,25}$/.test(tweetId)) return null;

  const authorRaw = (pick(item, ['author', 'user']) ?? {}) as Record<string, unknown>;
  const authorHandle = pickStr(authorRaw, ['userName', 'username', 'screen_name', 'screenName']);

  const createdRaw = pickStr(item, ['createdAt', 'created_at', 'date', 'timestamp']);
  const parsedDate = createdRaw ? new Date(createdRaw) : null;
  const postedAt = parsedDate && Number.isFinite(parsedDate.getTime()) ? parsedDate : null;

  const snapshot: GrowthPostSnapshot = {};
  const assign = (metric: keyof GrowthPostSnapshot, keys: string[]) => {
    const value = pickNum(item, keys);
    // Absent, never zero — X omits views and bookmarks inconsistently, and a
    // stored 0 would draw a cliff to the axis.
    if (value !== undefined) snapshot[metric] = value;
  };
  assign('likes', ['likeCount', 'favorite_count', 'favoriteCount', 'likes', 'favouriteCount']);
  assign('reposts', ['retweetCount', 'retweet_count', 'retweets']);
  assign('replies', ['replyCount', 'reply_count', 'replies']);
  assign('quotes', ['quoteCount', 'quote_count', 'quotes']);
  assign('views', ['viewCount', 'view_count', 'views', 'impressionCount']);
  assign('bookmarks', ['bookmarkCount', 'bookmark_count', 'bookmarks']);

  // Free inside the same result. Stored and displayed on the post — and NEVER
  // written into the follower series, which the nightly profile scrape owns.
  const authorFollowers = pickNum(authorRaw, ['followers', 'followers_count', 'followersCount']);
  if (authorFollowers !== undefined) snapshot.authorFollowers = authorFollowers;

  return {
    tweetId,
    url: pickStr(item, ['url', 'twitterUrl', 'tweetUrl']) ?? postUrlFor(tweetId, authorHandle),
    text: (pickStr(item, ['text', 'full_text', 'fullText']) ?? '').slice(0, TEXT_MAX),
    lang: pickStr(item, ['lang', 'language']),
    postedAt,
    isReply: item.isReply === true || pickStr(item, ['inReplyToId', 'in_reply_to_status_id_str']) !== null,
    isQuote: item.isQuote === true,
    isRetweet: item.isRetweet === true,
    conversationId: pickStr(item, ['conversationId', 'conversation_id_str', 'conversation_id']),
    media: parseMedia(item),
    authorHandle,
    authorHandleNormalized: authorHandle ? authorHandle.toLowerCase() : null,
    authorName: pickStr(authorRaw, ['name', 'displayName']),
    authorProfilePictureUrl: pickStr(authorRaw, ['profilePicture', 'profile_image_url_https', 'profileImageUrl']),
    authorIsVerified: authorRaw.isBlueVerified === true
      || authorRaw.isVerified === true
      || authorRaw.is_blue_verified === true
      || authorRaw.verified === true,
    snapshot,
  };
}

/** Media urls, from whichever entity container the actor populated. */
function parseMedia(item: Record<string, unknown>): GrowthPostMedia[] {
  const containers = [
    (item.extendedEntities as Record<string, unknown> | undefined)?.media,
    (item.entities as Record<string, unknown> | undefined)?.media,
    item.media,
  ];
  for (const container of containers) {
    if (!Array.isArray(container)) continue;
    const media = container
      .map((raw) => {
        const m = raw as Record<string, unknown>;
        const url = apifyStr(m.media_url_https) ?? apifyStr(m.media_url) ?? apifyStr(m.url);
        return url ? { type: apifyStr(m.type) ?? 'photo', url } : null;
      })
      .filter((m): m is GrowthPostMedia => m !== null);
    if (media.length > 0) return media.slice(0, 4);
  }
  return [];
}

// ─── Apify calls ─────────────────────────────────────────────────────

/** What a call cost, so the ledger and the logs agree on one number. */
export interface BilledCall<T> {
  results: T;
  /** Results we are billed for — never fewer than the actor's floor. */
  billedResults: number;
  costUsd: number;
}

function billed<T>(results: T, requested: number): BilledCall<T> {
  const billedResults = Math.max(MIN_BILLED_RESULTS, requested);
  return { results, billedResults, costUsd: billedResults * UNIT_COST_PER_RESULT };
}

/**
 * Refresh known posts by id — the cheap call shape.
 *
 * `tweetIDs` overrides every other filter, so nothing else is sent: an extra
 * parameter here is at best ignored and at worst changes what is billed.
 *
 * RULE 5: the returned items are reconciled against `tweetIds` and anything
 * unmatched is discarded. A zero-result response comes back as mock data, so an
 * unreconciled parse would write fabricated engagement onto real posts.
 */
export async function runTweetLookup(tweetIds: string[]): Promise<BilledCall<ScrapedPost[]>> {
  if (tweetIds.length === 0) return billed([], 0);

  const items = await runApifyActor<Record<string, unknown>>(TWEET_ACTOR, {
    tweetIDs: tweetIds,
  });

  const requested = new Set(tweetIds);
  const seen = new Set<string>();
  const posts: ScrapedPost[] = [];
  let rejected = 0;

  for (const item of items) {
    const post = parseScrapedPost(item);
    if (!post || !requested.has(post.tweetId) || seen.has(post.tweetId)) {
      rejected++;
      continue;
    }
    seen.add(post.tweetId);
    posts.push(post);
  }

  if (rejected > 0) {
    console.warn(
      `[growth-posts] Discarded ${rejected} lookup result(s) that did not match the ` +
      `${tweetIds.length} requested ids. Unmatched items are the actor's documented ` +
      `mock-data fill for a zero-result run and must never be stored.`,
    );
  }

  return billed(posts, tweetIds.length);
}

/**
 * Discover an account's newest posts — the call shape that pays the floor.
 *
 * One run for every handle: `searchTerms` takes one `from:` term each and
 * `maxItems` applies per term, so this is `handles.length × 20` results in a
 * single run rather than a run per account.
 *
 * The engagement numbers in these results are a full reading (rule 4), so the
 * caller records them rather than discovering the post and then paying again to
 * read it.
 */
export async function runPostDiscovery(
  handles: string[],
): Promise<BilledCall<Map<string, ScrapedPost[]>>> {
  const byHandle = new Map<string, ScrapedPost[]>();
  if (handles.length === 0) return billed(byHandle, 0);

  const items = await runApifyActor<Record<string, unknown>>(TWEET_ACTOR, {
    searchTerms: handles.map((h) => `from:${h}`),
    queryType: 'Latest',
    maxItems: DISCOVERY_MAX_ITEMS,
    // Retweets are excluded by default; both flags are pinned as assertions so
    // nobody "tidies them away" and doubles what a discovery run returns.
    'include:nativeretweets': false,
    'filter:nativeretweets': false,
  });

  const requested = new Set(handles.map((h) => h.toLowerCase()));
  let rejected = 0;

  for (const item of items) {
    const post = parseScrapedPost(item);
    // RULE 5 again, by author this time: an item whose author is not one of the
    // handles we asked about is mock fill or search bleed, not a result.
    if (!post || !post.authorHandleNormalized || !requested.has(post.authorHandleNormalized)) {
      rejected++;
      continue;
    }
    // Replies and retweets are paid for either way, but tracking them would bury
    // the account's own posts under conversation noise. Dropped after the fact
    // rather than filtered in the query, because an unsupported search operator
    // that returns nothing still bills — and returns mock data.
    if (post.isReply || post.isRetweet) continue;

    const list = byHandle.get(post.authorHandleNormalized) ?? [];
    list.push(post);
    byHandle.set(post.authorHandleNormalized, list);
  }

  if (rejected > 0) {
    console.warn(
      `[growth-posts] Discarded ${rejected} discovery result(s) whose author was not among ` +
      `the ${handles.length} handles requested.`,
    );
  }

  return billed(byHandle, handles.length * DISCOVERY_MAX_ITEMS);
}

// ─── Spend ledger ────────────────────────────────────────────────────

export function spendMonthKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 7);
}

/**
 * Record what a call cost. One document per month, incremented — so the breaker
 * costs one write per call and one read per run, not a scan.
 */
export async function recordSpend(billedResults: number, now: Date = new Date()): Promise<void> {
  if (billedResults <= 0) return;
  const month = spendMonthKey(now);
  await adminDb.collection(GROWTH_SPEND).doc(month).set({
    month,
    results: FieldValue.increment(billedResults),
    usd: FieldValue.increment(billedResults * UNIT_COST_PER_RESULT),
    runs: FieldValue.increment(1),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
}

export async function readSpendLedger(now: Date = new Date()): Promise<GrowthSpendLedger> {
  const month = spendMonthKey(now);
  const doc = await adminDb.collection(GROWTH_SPEND).doc(month).get();
  const d = doc.data() ?? {};
  return {
    month,
    results: (d.results as number) ?? 0,
    usd: (d.usd as number) ?? 0,
    runs: (d.runs as number) ?? 0,
    updatedAt: serializeTimestamp(d.updatedAt as Timestamp | null),
    actualUsd: (d.actualUsd as number) ?? null,
    actualTotalUsd: (d.actualTotalUsd as number) ?? null,
    actualRuns: (d.actualRuns as number) ?? null,
    actualSyncedAt: serializeTimestamp(d.actualSyncedAt as Timestamp | null),
  };
}

/**
 * The figure the ceiling is measured against.
 *
 * The **larger** of our estimate and Apify's measured tweet-actor spend, and
 * never just one of them. The estimate alone under-counts — it prices results
 * and ignores the compute, dataset and transfer usage that rides on the same
 * run. The measured figure alone lags: it is written by a background sync, so
 * the minutes between a burst of calls and the next sync would read as free.
 * Taking the max means neither blind spot can let spending through, which is
 * the only property a breaker actually needs.
 */
export function ledgerSpendUsd(ledger: GrowthSpendLedger): number {
  return Math.max(ledger.usd, ledger.actualUsd ?? 0);
}

/**
 * The money breaker. Returns the ledger plus whether spending is blocked, so
 * callers can both refuse and explain — the cron logs it, the UI shows it.
 */
export async function checkSpendCeiling(now: Date = new Date()): Promise<{
  blocked: boolean;
  ledger: GrowthSpendLedger;
}> {
  const ledger = await readSpendLedger(now);
  return { blocked: ledgerSpendUsd(ledger) >= MONTHLY_SPEND_CEILING_USD, ledger };
}

// ─── The refresh ladder ──────────────────────────────────────────────

/** When a post read at `readAt` next comes due, or the frozen sentinel. */
export function nextRefreshFor(postedAt: Date | null, readAt: Date): Date {
  const ageHours = postedAt
    ? Math.max(0, (readAt.getTime() - postedAt.getTime()) / 3_600_000)
    : 0;
  const interval = refreshIntervalHours(ageHours);
  return interval === null
    ? FROZEN_REFRESH_AT
    : new Date(readAt.getTime() + interval * 3_600_000);
}

// ─── Writes ──────────────────────────────────────────────────────────

/** A reading paired with the post document it belongs to, if it already exists. */
export interface PostReading {
  post: ScrapedPost;
  existing: GrowthPost | null;
  /** Set only when creating: who/what started tracking this post. */
  create?: { source: GrowthPostSource; accountId: string | null; addedBy: string };
}

/**
 * Record readings for a batch of posts, creating the ones that are new.
 *
 * `latest`/`previous` are denormalized so a list renders a velocity without
 * touching history, and `previous` only shifts when the reading key actually
 * changes — re-reading inside the same minute overwrites rather than discarding
 * the genuinely previous value.
 *
 * The history write is a nested merge into `history.<key>`, so a post document
 * accumulates readings without ever being rewritten wholesale.
 */
export async function recordPostReadings(
  readings: PostReading[],
  readAt: Date = new Date(),
): Promise<void> {
  if (readings.length === 0) return;

  const key = snapshotKey(readAt);
  const batch = adminDb.batch();
  const now = FieldValue.serverTimestamp();

  for (const { post, existing, create } of readings) {
    const ref = adminDb.collection(GROWTH_POSTS).doc(post.tweetId);
    const sameKey = existing?.latest?.at === key;

    // Metadata is rewritten on every read: a display name, avatar or verified
    // badge can change, and the text can be edited. The identity (the id) cannot.
    const meta: Record<string, unknown> = {
      url: post.url,
      text: post.text,
      lang: post.lang,
      postedAt: post.postedAt ? Timestamp.fromDate(post.postedAt) : null,
      isReply: post.isReply,
      isQuote: post.isQuote,
      isRetweet: post.isRetweet,
      conversationId: post.conversationId,
      media: post.media,
      authorHandle: post.authorHandle,
      authorHandleNormalized: post.authorHandleNormalized,
      authorName: post.authorName,
      authorProfilePictureUrl: post.authorProfilePictureUrl,
      authorIsVerified: post.authorIsVerified,
    };

    const history: Record<string, unknown> = { [key]: post.snapshot };
    // Prune while the document is already in hand — free, and it keeps a post
    // that has been manually synced for months from growing without bound.
    if (existing) {
      const keys = Object.keys(existing.history ?? {}).sort();
      const excess = keys.length + (sameKey ? 0 : 1) - HISTORY_MAX_POINTS;
      for (let i = 0; i < excess; i++) history[keys[i]] = FieldValue.delete();
    }

    batch.set(ref, {
      ...meta,
      ...(create
        ? {
            isActive: true,
            source: create.source,
            accountId: create.accountId,
            addedBy: create.addedBy,
            addedTime: now,
            previous: null,
            lastManualSyncAt: null,
          }
        : {}),
      latest: { ...post.snapshot, at: key },
      ...(sameKey || create ? {} : { previous: existing?.latest ?? null }),
      history,
      nextRefreshAt: Timestamp.fromDate(nextRefreshFor(post.postedAt, readAt)),
      lastReadAt: now,
      lastReadStatus: 'ok',
      lastReadError: null,
      readCount: FieldValue.increment(1),
    }, { merge: true });
  }

  await batch.commit();

  // A separate commit, deliberately. The engagement readings above are already
  // paid for, so a failure writing the follower side must not roll them back —
  // and keeping the two apart also keeps either batch clear of the 500-write
  // ceiling no matter how large a refresh cycle grows.
  try {
    await applyAuthorFollowers(readings.map((r) => r.post), readAt);
  } catch (error) {
    console.error('[growth-posts] follower write-through failed (readings were kept):', error);
  }
}

/**
 * Write the author follower counts that rode along inside these post results
 * onto the tracked accounts they belong to.
 *
 * ═══ THIS WRITES INTO THE FOLLOWER SERIES — the subsystem's primary dataset ═══
 *
 * Every tweet result carries `author.followers` free, and the refresh cycle runs
 * four times a day against a profile scrape that runs once. So for a tracked X
 * account with tracked posts, this is the fresher number, at no additional cost.
 *
 * **The profile scrape is not replaced and must not be.** It is the only
 * guaranteed daily reading: it covers Facebook, X accounts with post tracking
 * off, accounts that posted nothing, and nights the tweet actor fails. Making it
 * conditional on post tracking would mean one bad tweet run leaves a permanent
 * hole in a series that cannot be re-collected. It costs $0.028/night.
 *
 * Three things keep this safe:
 *
 *  1. **Only tracked X accounts are written.** A handle with no `growth-accounts`
 *     document is skipped — an ad-hoc pasted post from a stranger's account does
 *     not create one.
 *  2. **The value must be plausible** (`FOLLOWER_SANITY_MULTIPLE`). This is the
 *     second line against the actor's mock-data fill, after the handle
 *     reconciliation in `runTweetLookup` / `runPostDiscovery`.
 *  3. **Every write is stamped `src: 'post'`**, so a day's number can always be
 *     traced back to which scraper produced it.
 *
 * Within a day the last write wins, so a day's recorded figure becomes the final
 * refresh of that day rather than the 00:00 profile reading — a fuller day's
 * growth, and internally consistent per account, which is all a day-over-day
 * delta needs. `previous` still shifts only on a real day change, exactly as
 * `recordSnapshots` does it.
 */
async function applyAuthorFollowers(posts: ScrapedPost[], readAt: Date): Promise<void> {
  const dayKey = utcDayKey(readAt);

  // One value per handle. Every post in a batch was read in the same call, so
  // they all report the same follower count — the last one wins arbitrarily and
  // that is fine.
  const byHandle = new Map<string, number>();
  for (const post of posts) {
    const handle = post.authorHandleNormalized;
    const followers = post.snapshot.authorFollowers;
    if (!handle || typeof followers !== 'number' || followers <= 0) continue;
    byHandle.set(handle, followers);
  }
  if (byHandle.size === 0) return;

  const handles = [...byHandle.keys()];
  const refs = handles.map((h) => adminDb.collection(GROWTH_ACCOUNTS).doc(growthAccountId('twitter', h)));
  const docs = await adminDb.getAll(...refs);

  const batch = adminDb.batch();
  let staged = 0;

  docs.forEach((doc, i) => {
    if (!doc.exists) return; // not a tracked account — nothing to update
    const data = doc.data() ?? {};
    if (data.platform !== 'twitter') return; // defensive; the id already implies it

    const followers = byHandle.get(handles[i])!;
    const current = data.latest as (GrowthSnapshot & { date?: string }) | undefined;
    const previousValue = current?.followers;

    if (typeof previousValue === 'number' && previousValue > 0) {
      const ratio = followers / previousValue;
      if (ratio > FOLLOWER_SANITY_MULTIPLE || ratio < 1 / FOLLOWER_SANITY_MULTIPLE) {
        console.warn(
          `[growth-posts] Refused a post-derived follower count for @${handles[i]}: ` +
          `${followers} against a last known ${previousValue}. Outside the ${FOLLOWER_SANITY_MULTIPLE}x ` +
          `sanity band, so it is far more likely a bad parse or a mock-data row than real growth. ` +
          `The nightly profile scrape still supplies this day's number.`,
        );
        return;
      }
    }

    const sameDay = current?.date === dayKey;
    // Only `followers`, `date` and `src` are set. Firestore deep-merges maps, so
    // the extras the profile scrape wrote (`following`, `posts`, `media`,
    // `favourites`) survive untouched — this reading simply does not know them.
    // On a day the profile scrape has not run, those extras lag by a day; the
    // next successful profile run corrects them.
    batch.set(refs[i], {
      latest: { followers, date: dayKey, src: 'post' },
      ...(sameDay ? {} : { previous: current ?? null }),
    }, { merge: true });

    batch.set(
      refs[i].collection(GROWTH_SERIES_SUB).doc(seriesDocIdFor(dayKey)),
      { days: { [dayKey]: { followers, src: 'post' } } },
      { merge: true },
    );
    staged++;
  });

  if (staged > 0) await batch.commit();
}

/**
 * Mark posts a refresh did not return.
 *
 * `latest` is left untouched, exactly as `recordScrapeFailures` does for
 * accounts: a failed read means "we do not know this post's numbers right now",
 * not "engagement dropped to zero". `nextRefreshAt` still advances, so one
 * deleted post cannot pin the batch and be re-requested on every single run.
 */
export async function recordPostFailures(
  posts: Array<{ id: string; postedAt: string | null }>,
  error: string,
  readAt: Date = new Date(),
): Promise<void> {
  if (posts.length === 0) return;
  const batch = adminDb.batch();
  for (const { id, postedAt } of posts) {
    batch.set(adminDb.collection(GROWTH_POSTS).doc(id), {
      lastReadAt: FieldValue.serverTimestamp(),
      lastReadStatus: 'failed',
      lastReadError: error.slice(0, 500),
      nextRefreshAt: Timestamp.fromDate(
        nextRefreshFor(postedAt ? new Date(postedAt) : null, readAt),
      ),
    }, { merge: true });
  }
  await batch.commit();
}

/** Stamp a manual sync so the server-side cooldown can be enforced (rule 4). */
export async function stampManualSync(tweetId: string): Promise<void> {
  await adminDb.collection(GROWTH_POSTS).doc(tweetId).set(
    { lastManualSyncAt: FieldValue.serverTimestamp() },
    { merge: true },
  );
}

/**
 * Start the manual cooldown on several posts at once — the account refresh,
 * which asks for every post it owns in one call.
 *
 * Only the posts that were **requested** are stamped, never the padding that
 * rode along free. A padded post got a fresh reading it did not ask for; locking
 * its own button for fifteen minutes because of that would charge a user for
 * someone else's call.
 */
export async function stampManualSyncMany(tweetIds: string[]): Promise<void> {
  if (tweetIds.length === 0) return;
  const batch = adminDb.batch();
  const at = FieldValue.serverTimestamp();
  for (const id of tweetIds) {
    batch.set(adminDb.collection(GROWTH_POSTS).doc(id), { lastManualSyncAt: at }, { merge: true });
  }
  await batch.commit();
}

// ─── Reads / serialization ───────────────────────────────────────────

export function serializeGrowthPost(doc: DocumentSnapshot, historyLimit?: number): GrowthPost {
  const d = doc.data() ?? {};
  const rawHistory = (d.history ?? {}) as Record<string, GrowthPostSnapshot>;

  // The list view ships a trimmed tail so a 300-post payload stays small; the
  // detail view asks for all of it. Trimming keeps the NEWEST readings, which
  // are the ones every chart and velocity actually uses.
  let history = rawHistory;
  if (historyLimit !== undefined) {
    const keys = Object.keys(rawHistory).sort();
    if (keys.length > historyLimit) {
      history = {};
      for (const key of keys.slice(-historyLimit)) history[key] = rawHistory[key];
    }
  }

  return {
    id: doc.id,
    url: (d.url as string) ?? postUrlFor(doc.id, (d.authorHandle as string) ?? null),
    authorHandle: (d.authorHandle as string) ?? null,
    authorHandleNormalized: (d.authorHandleNormalized as string) ?? null,
    authorName: (d.authorName as string) ?? null,
    authorProfilePictureUrl: (d.authorProfilePictureUrl as string) ?? null,
    authorIsVerified: d.authorIsVerified === true,
    text: (d.text as string) ?? '',
    lang: (d.lang as string) ?? null,
    postedAt: serializeTimestamp(d.postedAt as Timestamp | null),
    isReply: d.isReply === true,
    isQuote: d.isQuote === true,
    isRetweet: d.isRetweet === true,
    conversationId: (d.conversationId as string) ?? null,
    media: (d.media as GrowthPostMedia[]) ?? [],
    source: (d.source as GrowthPostSource) ?? 'manual',
    accountId: (d.accountId as string) ?? null,
    isActive: d.isActive !== false,
    latest: (d.latest as GrowthPost['latest']) ?? null,
    previous: (d.previous as GrowthPost['previous']) ?? null,
    history,
    nextRefreshAt: serializeTimestamp(d.nextRefreshAt as Timestamp | null),
    lastReadAt: serializeTimestamp(d.lastReadAt as Timestamp | null),
    lastReadStatus: (d.lastReadStatus as GrowthPost['lastReadStatus']) ?? null,
    lastReadError: (d.lastReadError as string) ?? null,
    lastManualSyncAt: serializeTimestamp(d.lastManualSyncAt as Timestamp | null),
    readCount: (d.readCount as number) ?? 0,
    addedBy: (d.addedBy as string) ?? '',
    addedTime: serializeTimestamp(d.addedTime as Timestamp | null),
  };
}

/**
 * Every tracked post, newest first, with history trimmed for the wire.
 *
 * Bounded by `MAX_TRACKED_POSTS`, so this is at most 300 reads for the whole
 * page and the client slices ranges in memory afterwards — the same trade the
 * follower series makes, and for the same reason (rule 9).
 */
export async function listGrowthPosts(historyLimit = 24): Promise<GrowthPost[]> {
  const snap = await adminDb.collection(GROWTH_POSTS)
    .orderBy('postedAt', 'desc')
    .limit(MAX_TRACKED_POSTS)
    .get();
  return snap.docs.map((doc) => serializeGrowthPost(doc, historyLimit));
}

/**
 * One account's tracked posts — by `accountId` **or** by author handle.
 *
 * Both, for the reason the panel filters on both: a post pasted by hand carries
 * no `accountId`, and filing only by that field would leave a manually tracked
 * post out of its own author's refresh. The two equality queries ride the
 * automatic single-field indexes (neither field is exempted), which is why this
 * is two small reads rather than a full collection scan — `listGrowthPosts`
 * would read every post on the roster to find a dozen (rule 9).
 */
export async function listPostsForAccount(
  accountId: string,
  handleNormalized: string,
  historyLimit = 24,
): Promise<GrowthPost[]> {
  const collection = adminDb.collection(GROWTH_POSTS);
  const [byAccount, byHandle] = await Promise.all([
    collection.where('accountId', '==', accountId).get(),
    handleNormalized
      ? collection.where('authorHandleNormalized', '==', handleNormalized).get()
      : Promise.resolve(null),
  ]);

  // Deduped by document id: a discovered post matches both queries.
  const posts = new Map<string, GrowthPost>();
  for (const doc of byAccount.docs) posts.set(doc.id, serializeGrowthPost(doc, historyLimit));
  for (const doc of byHandle?.docs ?? []) posts.set(doc.id, serializeGrowthPost(doc, historyLimit));
  return [...posts.values()];
}

/**
 * Stop every one of an account's posts, in one batched write.
 *
 * Called when an account is stopped. Stopping an account is the instruction to
 * stop spending on it, and its posts are a line on the *same* bill — leaving
 * them in the refresh queue would keep buying readings for an account the user
 * just switched off, which is the one thing stopping is supposed to prevent.
 *
 * It is **not** symmetrical: resuming the account does not resume its posts.
 * Follower scraping is one cheap call, while resuming twenty posts restarts
 * twenty billed refreshes — a cost nobody asked for by clicking "Resume". They
 * are resumed one at a time, from the account panel that still lists them.
 *
 * Returns how many were actually stopped, so the caller can say so rather than
 * claim a number it guessed. Already-stopped posts are skipped: writing
 * `isActive: false` over `false` is a billed write that changes nothing (rule 9).
 */
export async function stopPostsForAccount(
  accountId: string,
  handleNormalized: string,
): Promise<number> {
  const collection = adminDb.collection(GROWTH_POSTS);
  const [byAccount, byHandle] = await Promise.all([
    collection.where('accountId', '==', accountId).get(),
    handleNormalized
      ? collection.where('authorHandleNormalized', '==', handleNormalized).get()
      : Promise.resolve(null),
  ]);

  // Deduped by id: a discovered post matches both queries, and writing it twice
  // in one batch is an error rather than a no-op.
  const ids = new Set<string>();
  for (const doc of [...byAccount.docs, ...(byHandle?.docs ?? [])]) {
    if (doc.get('isActive') !== false) ids.add(doc.id);
  }
  if (ids.size === 0) return 0;

  const batch = adminDb.batch();
  for (const id of ids) batch.update(collection.doc(id), { isActive: false });
  await batch.commit();
  return ids.size;
}

export async function getGrowthPost(tweetId: string): Promise<GrowthPost | null> {
  const doc = await adminDb.collection(GROWTH_POSTS).doc(tweetId).get();
  return doc.exists ? serializeGrowthPost(doc) : null;
}

export async function countGrowthPosts(): Promise<number> {
  return (await adminDb.collection(GROWTH_POSTS).count().get()).data().count;
}

/**
 * The refresh queue: which posts to read next, and which of those were actually
 * due.
 *
 * ONE query, ordered by `nextRefreshAt`, partitioned in memory — the due posts
 * are the prefix. That is deliberate: a second query for padding candidates
 * would need its own index and would return the same documents.
 *
 * `pad` is rule 3 in one line. The floor is billed whatever the batch size, so
 * a batch short of it is topped up with the next-stalest posts. Those readings
 * are free; declining to take them is not a saving.
 */
export async function selectPostsForRefresh(limit = MAX_REFRESH_PER_RUN, now: Date = new Date()): Promise<{
  batch: GrowthPost[];
  due: GrowthPost[];
  padded: GrowthPost[];
}> {
  const snap = await adminDb.collection(GROWTH_POSTS)
    .where('isActive', '==', true)
    .orderBy('nextRefreshAt', 'asc')
    .limit(limit)
    .get();

  const ordered = snap.docs.map((doc) => serializeGrowthPost(doc));
  const isDue = (p: GrowthPost) => p.nextRefreshAt !== null && Date.parse(p.nextRefreshAt) <= now.getTime();

  const due = ordered.filter(isDue);
  if (due.length === 0) return { batch: [], due: [], padded: [] };

  const padded = due.length >= MIN_BILLED_RESULTS
    ? []
    : ordered.filter((p) => !isDue(p)).slice(0, MIN_BILLED_RESULTS - due.length);

  return { batch: [...due, ...padded], due, padded };
}

/**
 * Padding candidates for a one-off call (an add, or a manual sync) that would
 * otherwise send a single id and be billed for twenty.
 *
 * Excludes `exclude` so the target is not requested twice, and takes the
 * stalest first so the free readings go where they are worth most.
 */
export async function stalestPostsForPadding(
  count: number,
  exclude: string[] = [],
): Promise<GrowthPost[]> {
  if (count <= 0) return [];
  const snap = await adminDb.collection(GROWTH_POSTS)
    .where('isActive', '==', true)
    .orderBy('nextRefreshAt', 'asc')
    .limit(count + exclude.length)
    .get();

  const excluded = new Set(exclude);
  return snap.docs
    .map((doc) => serializeGrowthPost(doc))
    .filter((p) => !excluded.has(p.id))
    .slice(0, count);
}

/** Index a batch of already-loaded posts for `recordPostReadings`. */
export function readingsFrom(
  posts: ScrapedPost[],
  existingById: Map<string, GrowthPost>,
): PostReading[] {
  return posts.map((post) => ({ post, existing: existingById.get(post.tweetId) ?? null }));
}

/** Access gate — the same single tier the rest of Growth Tracking uses. */
export { checkGrowthAccess } from '@/lib/services/growthTrackingService';

/** Cost of a batch, for the cron's log line and the UI's estimate. */
export function estimatePostCost(billedResults: number): number {
  return billedResults * UNIT_COST_PER_RESULT;
}

export function spendCeilingResponse(ledger: GrowthSpendLedger): NextResponse {
  return NextResponse.json({
    error:
      `The monthly post-tracking budget of $${MONTHLY_SPEND_CEILING_USD.toFixed(2)} has been ` +
      `reached ($${ledgerSpendUsd(ledger).toFixed(2)} spent across ${ledger.runs} runs this month). ` +
      `Refreshing is paused until next month, or until the ceiling is raised deliberately.`,
  }, { status: 429 });
}

/**
 * Load several posts by id in one `getAll`.
 *
 * The discovery pass needs to know which of the ~20 posts it just read are
 * already tracked (a reading) and which are new (a creation). One batched read
 * answers that for the whole run — never a `get()` per post (rule 9).
 */
export async function getGrowthPostsByIds(ids: string[]): Promise<Map<string, GrowthPost>> {
  const found = new Map<string, GrowthPost>();
  if (ids.length === 0) return found;

  const refs = ids.map((id) => adminDb.collection(GROWTH_POSTS).doc(id));
  for (const doc of await adminDb.getAll(...refs)) {
    if (doc.exists) found.set(doc.id, serializeGrowthPost(doc));
  }
  return found;
}

/**
 * Stamp a discovery pass onto the account it ran for.
 *
 * Writes into `growth-accounts`, which the follower scrape owns — deliberately,
 * and only these four fields. Post tracking is an opt-in *on an account*, so its
 * state belongs next to the toggle that controls it rather than in a parallel
 * collection nothing else reads.
 *
 * `saturated` means the ~20-result window came back entirely filled with posts
 * under a day old: this account posts faster than one nightly read can see, so
 * posts are being missed. Recorded rather than silently tolerated — the manage
 * tab surfaces it so someone can decide whether to act.
 */
export async function recordDiscoveryOutcomes(
  outcomes: Array<{
    accountId: string;
    status: 'ok' | 'failed';
    error?: string;
    saturated?: boolean;
  }>,
): Promise<void> {
  if (outcomes.length === 0) return;
  // One batch, not a write per account: a run covers up to
  // MAX_DISCOVERY_ACCOUNTS handles and a sequential `set()` each would be that
  // many round trips for four fields apiece (rule 9).
  const batch = adminDb.batch();
  for (const outcome of outcomes) {
    batch.set(adminDb.collection(GROWTH_ACCOUNTS).doc(outcome.accountId), {
      lastPostDiscoveryAt: FieldValue.serverTimestamp(),
      lastPostDiscoveryStatus: outcome.status,
      lastPostDiscoveryError: outcome.error ? outcome.error.slice(0, 500) : null,
      postsWindowSaturated: outcome.saturated === true,
    }, { merge: true });
  }
  await batch.commit();
}

// ─── Discovery ───────────────────────────────────────────────────────

/** The minimum an account needs to be searched for. */
export interface DiscoveryAccount {
  id: string;
  handle: string;
  handleNormalized: string;
}

export interface DiscoveryOutcome {
  /** Posts newly added to the roster. */
  created: number;
  /** Already-tracked posts that took a free reading out of the same result. */
  refreshed: number;
  /**
   * Tweet ids this pass touched. The id refresh batch **must** skip these — their
   * readings are already recorded and `nextRefreshAt` already advanced, so
   * re-requesting them is paying twice for the same number (RULE 2, rule 4).
   */
  discoveredIds: Set<string>;
  billedResults: number;
  costUsd: number;
  /** Handles the search returned nothing usable for. */
  emptyHandles: string[];
  /** Set when the whole call failed; every account is stamped failed. */
  error: string | null;
}

/**
 * Search these accounts' timelines, track what is new, and record a reading for
 * everything returned.
 *
 * ONE search run covers every account passed — `searchTerms` takes a `from:`
 * term each and `maxItems` applies per term, so this is `accounts.length × 20`
 * results in a single run rather than a run per account. The caller decides
 * *who* is due; this decides nothing about scheduling.
 *
 * Shared by the nightly cron and by the Track-posts toggle, deliberately: the
 * mock-data reconciliation, the roster breaker and the saturation check are all
 * things a second copy would drift on, and each of them is load-bearing.
 *
 * Failure is contained rather than thrown. Every account is stamped either way,
 * so a caller that also has other work to do (the cron's refresh pass) keeps it.
 */
export async function discoverPostsForAccounts(
  accounts: DiscoveryAccount[],
  now: Date = new Date(),
): Promise<DiscoveryOutcome> {
  const base: DiscoveryOutcome = {
    created: 0,
    refreshed: 0,
    discoveredIds: new Set(),
    billedResults: 0,
    costUsd: 0,
    emptyHandles: [],
    error: null,
  };
  if (accounts.length === 0) return base;

  let call: BilledCall<Map<string, ScrapedPost[]>>;
  try {
    call = await runPostDiscovery(accounts.map((a) => a.handle));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await recordDiscoveryOutcomes(
      accounts.map((a) => ({ accountId: a.id, status: 'failed' as const, error: message })),
    );
    return { ...base, error: message };
  }

  await recordSpend(call.billedResults);

  // One batched read says which of these are already tracked. New ones are
  // created; known ones simply take the reading they arrived with.
  const allPosts = [...call.results.values()].flat();
  const existingById = await getGrowthPostsByIds(allPosts.map((p) => p.tweetId));
  let roster = await countGrowthPosts();

  const discoveredIds = new Set<string>();
  const emptyHandles: string[] = [];
  const readings: PostReading[] = [];
  const outcomes: Array<{ accountId: string; status: 'ok' | 'failed'; error?: string; saturated?: boolean }> = [];
  let created = 0;
  let refreshed = 0;

  for (const account of accounts) {
    const found = call.results.get(account.handleNormalized) ?? [];

    if (found.length === 0) {
      // Not necessarily "this account has been quiet" — a `from:` search returns
      // older posts too. Nothing surviving reconciliation means the run told us
      // nothing about this account at all.
      emptyHandles.push(account.handle);
      outcomes.push({
        accountId: account.id,
        status: 'failed',
        error: 'The search returned no posts for this account. It may have been renamed, made private, or removed.',
      });
      continue;
    }

    for (const post of found) {
      discoveredIds.add(post.tweetId);
      const existing = existingById.get(post.tweetId) ?? null;
      if (existing) {
        readings.push({ post, existing });
        refreshed++;
        continue;
      }
      // The roster breaker applies to automatic creation exactly as it does to a
      // manual add — a toggle must not be able to walk past a ceiling a person
      // would be refused at.
      if (roster >= MAX_TRACKED_POSTS) continue;
      roster++;
      created++;
      readings.push({
        post,
        existing: null,
        create: { source: 'account', accountId: account.id, addedBy: `account:${account.id}` },
      });
    }

    outcomes.push({ accountId: account.id, status: 'ok', saturated: isWindowSaturated(found, now) });
  }

  await recordPostReadings(readings, now);
  await recordDiscoveryOutcomes(outcomes);

  return {
    created,
    refreshed,
    discoveredIds,
    billedResults: call.billedResults,
    costUsd: call.costUsd,
    emptyHandles,
    error: null,
  };
}

/**
 * Whether a discovery window came back full of posts under a day old.
 *
 * A search returns roughly 20 posts and the vendor documents pagination as
 * unreliable, so an account posting faster than that cannot be fully seen by one
 * daily read — and *silently* missing posts is the problem, not missing them.
 * Recorded on the account so the manage tab can say so, rather than quietly
 * raising the cadence for the whole roster to fix one account.
 */
function isWindowSaturated(posts: ScrapedPost[], now: Date): boolean {
  if (posts.length < DISCOVERY_MAX_ITEMS) return false;
  const oldest = posts
    .map((p) => p.postedAt?.getTime())
    .filter((t): t is number => typeof t === 'number')
    .sort((a, b) => a - b)[0];
  return oldest !== undefined && now.getTime() - oldest < 24 * 3_600_000;
}
