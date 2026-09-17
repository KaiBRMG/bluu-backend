/**
 * Growth Tracking — the follower scrape. Owns the two profile actors below;
 * the tweet actor for post analytics lives in `growthPostsService.ts`, which
 * borrows this file's Apify runner and nothing else.
 *
 * ═══ COST IS THE GOVERNING CONSTRAINT — read this before changing anything ═══
 *
 *   apify/facebook-pages-scraper   $0.010 per page
 *   apidojo/twitter-user-scraper   $0.004 per profile URL
 *
 * At the seed list (5 Facebook + 7 X) that is ~$0.078/night, ~$2.35/month. Three
 * rules keep it there, and all three are easy to break by accident:
 *
 *  1. The X actor is called with `twitterHandles` ONLY. `getFollowers`,
 *     `getFollowing` and `getRetweeters` are the $0.016-per-query paths and are
 *     passed explicitly `false` below so nobody "tidies them away" and turns a
 *     $2/month job into a $400/month one. They are not defaults to rely on —
 *     they are assertions.
 *  2. `maxItems` is pinned to the batch size. It is the hard ceiling on what a
 *     single run can bill, whatever the actor decides to return.
 *  3. ONE run per platform per night, batching every account — never one run
 *     per account. Same price per result, far fewer round trips.
 *
 * Both actors return extra fields inside the same billed result, so followers,
 * likes, rating, post counts etc. cost nothing additional. Those are stored and
 * displayed. Anything requiring a *separate* query is out of scope.
 *
 * NEVER call the Apify API by hand to explore a payload — see the equivalent
 * rule 9b for the OnlyFans provider. Add a defensive field probe instead.
 */

import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getUserById } from '@/lib/services/userService';
import { serializeTimestamp } from '@/lib/middleware/apiHelpers';
import {
  growthAccountId,
  seriesDocIdFor,
  utcDayKey,
  type GrowthPlatform,
} from '@/lib/growth/platform';
import { normalizeCategory } from '@/lib/growth/category';
import type { GrowthAccount, GrowthSeries, GrowthSnapshot } from '@/types/firestore';
import type { DocumentSnapshot } from 'firebase-admin/firestore';

// ─── Collections ─────────────────────────────────────────────────────

export const GROWTH_ACCOUNTS = 'growth-accounts';
export const GROWTH_SERIES_SUB = 'series';

/**
 * Circuit breaker. The nightly bill is linear in the tracked-account count, so a
 * runaway import or a scripted bulk-add could quietly multiply it. Past this the
 * cron refuses to run and logs loudly rather than spending the money and telling
 * nobody. Raise it deliberately, with the cost in mind — not to clear an error.
 *
 * Raised 60 → 100 to admit the full managed roster (60 X accounts + 12 Facebook
 * pages, imported by `scripts/import-growth-accounts.js`). That roster reads
 * ~$0.36/night, ~$10.90/month — about five times the seed list, and the reason
 * the number moved is that the accounts were counted, not that a limit was in
 * the way. The headroom above 72 is for hand-added accounts, not for another
 * bulk import: the next one should re-do this arithmetic first.
 */
export const MAX_TRACKED_ACCOUNTS = 100;

const FACEBOOK_ACTOR = 'apify~facebook-pages-scraper';
const TWITTER_ACTOR = 'apidojo~twitter-user-scraper';

/** Unit price per result, for the cost line in the cron's log output. */
const UNIT_COST: Record<GrowthPlatform, number> = { facebook: 0.01, twitter: 0.004 };

// ─── Access gate ─────────────────────────────────────────────────────

/**
 * Page-permission gate. Growth Tracking is *not* split into read and write
 * tiers: anyone holding the page may add and remove accounts (confirmed with
 * the user). smm-admin is accepted too, so an admin is never locked out of a
 * page in their own teamspace.
 *
 * Like `checkSmmAccess` this is a page permission, NOT the admin JWT claim —
 * these routes touch no part of the auth graph. `getUserById` is cached (60s).
 */
export async function checkGrowthAccess(uid: string): Promise<NextResponse | null> {
  const pages = (await getUserById(uid))?.permittedPageIds ?? [];
  const ok = pages.includes('smm-growth-tracking') || pages.includes('smm-admin');
  return ok ? null : NextResponse.json({ error: 'Access denied' }, { status: 403 });
}

// ─── Apify ───────────────────────────────────────────────────────────

/** A reading for one account, as returned by a scrape. */
export interface ScrapeResult {
  handleNormalized: string;
  snapshot: GrowthSnapshot;
  profilePictureUrl: string | null;
  isVerified: boolean;
  /**
   * The platform's own account id, when the actor reports one. Free inside the
   * already-billed result. The field spelling is unverified against a live
   * payload — calling the API to look is banned (rule 9d) — so `pickId` probes
   * the plausible spellings and the value stays optional everywhere downstream.
   */
  platformAccountId: string | null;
}

function apifyToken(): string {
  const token = process.env.APIFY_API_KEY;
  if (!token) throw new Error('APIFY_API_KEY is not configured');
  return token;
}

/**
 * Run an actor and return its dataset items.
 *
 * `run-sync-get-dataset-items` blocks until the run finishes and hands back the
 * results in one call — no polling, no webhook, no run-id bookkeeping. The
 * actors take 10–30s, which is why the callers set a generous `maxDuration`.
 * The 300s ceiling here is the actor's own; the route's limit is separate and
 * must be at least as large.
 */
async function runActor<T>(actor: string, input: unknown): Promise<T[]> {
  const res = await fetch(
    `https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items?token=${apifyToken()}&timeout=300`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  );

  if (!res.ok) {
    // The body carries Apify's reason (bad input, exhausted credit, actor
    // failure) and is worth surfacing — but truncated, since a failing actor can
    // return a very long HTML page.
    const detail = (await res.text().catch(() => '')).slice(0, 300);
    throw new Error(`Apify ${actor} failed (${res.status}): ${detail}`);
  }

  const items = await res.json();
  return Array.isArray(items) ? (items as T[]) : [];
}

/** A number that may arrive as a string, or not at all. */
function num(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/,/g, ''));
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * The platform's own account id out of whichever field the actor populated.
 *
 * Written as a probe rather than a single field read because the payload shape
 * cannot be checked against the live API (rule 9d — every call is billed), and
 * these scrapers demonstrably vary between `id` / `id_str` / `rest_id`. An id
 * that arrives as a number is kept as a string: it is an opaque key that is only
 * ever compared and searched, and X ids are past 2^53.
 */
function pickId(item: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = item[key];
    if (typeof value === 'string' && /^[0-9]+$/.test(value.trim())) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return null;
}

/**
 * Scrape Facebook pages. ONE run for every URL — `startUrls` is the actor's only
 * documented input, and it bills per page either way.
 */
export async function runFacebookScrape(
  accounts: Array<{ handleNormalized: string; profileUrl: string }>,
): Promise<ScrapeResult[]> {
  if (accounts.length === 0) return [];

  const items = await runActor<Record<string, unknown>>(FACEBOOK_ACTOR, {
    startUrls: accounts.map((a) => ({ url: a.profileUrl })),
  });

  // The actor does not guarantee input order, and `pageUrl`/`facebookUrl` may be
  // a canonical form that differs from what was submitted — so results are
  // matched back by handle rather than by position.
  const byHandle = new Map<string, ScrapeResult>();
  for (const item of items) {
    const handle = handleFromFacebookItem(item);
    const followers = num(item.followers) ?? num(item.likes);
    if (!handle || followers === undefined) continue;

    // Stamped at the source so the series stays auditable. Without it a later
    // post-derived write would leave `src: 'post'` in place on this document
    // forever — Firestore's `merge` deep-merges maps, so a field this path
    // never sets is a field this path never clears.
    const snapshot: GrowthSnapshot = { followers, src: 'profile' };
    const likes = num(item.likes);
    const rating = num(item.rating);
    const ratingCount = num(item.ratingCount);
    if (likes !== undefined) snapshot.likes = likes;
    if (rating !== undefined) snapshot.rating = rating;
    if (ratingCount !== undefined) snapshot.ratingCount = ratingCount;

    byHandle.set(handle, {
      handleNormalized: handle,
      snapshot,
      profilePictureUrl: str(item.profilePictureUrl),
      isVerified: false, // the actor does not report page verification
      platformAccountId: pickId(item, ['pageId', 'facebookId', 'id', 'pageID']),
    });
  }

  return accounts.map((a) => byHandle.get(a.handleNormalized)).filter((r): r is ScrapeResult => !!r);
}

/** Pull the handle out of whichever URL field the Facebook actor populated. */
function handleFromFacebookItem(item: Record<string, unknown>): string | null {
  for (const key of ['pageUrl', 'facebookUrl', 'url']) {
    const value = str(item[key]);
    if (!value) continue;
    try {
      const segment = new URL(value).pathname.split('/').filter(Boolean)[0];
      if (segment) return decodeURIComponent(segment).toLowerCase();
    } catch {
      // not a URL — try the next field
    }
  }
  return null;
}

/**
 * Scrape X profiles. ONE run for every handle.
 *
 * The three `get*` flags below are the expensive paths and are pinned `false`
 * on purpose — see the cost note at the top of this file. `maxItems` caps the
 * run at exactly the number of profiles requested.
 */
export async function runTwitterScrape(
  accounts: Array<{ handleNormalized: string; handle: string }>,
): Promise<ScrapeResult[]> {
  if (accounts.length === 0) return [];

  const items = await runActor<Record<string, unknown>>(TWITTER_ACTOR, {
    twitterHandles: accounts.map((a) => a.handle),
    maxItems: accounts.length,
    getFollowers: false,
    getFollowing: false,
    getRetweeters: false,
  });

  const byHandle = new Map<string, ScrapeResult>();
  for (const item of items) {
    const handle = str(item.userName)?.toLowerCase();
    const followers = num(item.followers);
    if (!handle || followers === undefined) continue;

    // Stamped at the source so the series stays auditable. Without it a later
    // post-derived write would leave `src: 'post'` in place on this document
    // forever — Firestore's `merge` deep-merges maps, so a field this path
    // never sets is a field this path never clears.
    const snapshot: GrowthSnapshot = { followers, src: 'profile' };
    const following = num(item.following);
    const posts = num(item.statusesCount);
    const media = num(item.mediaCount);
    const favourites = num(item.favouritesCount);
    if (following !== undefined) snapshot.following = following;
    if (posts !== undefined) snapshot.posts = posts;
    if (media !== undefined) snapshot.media = media;
    if (favourites !== undefined) snapshot.favourites = favourites;

    byHandle.set(handle, {
      handleNormalized: handle,
      snapshot,
      profilePictureUrl: str(item.profilePicture),
      isVerified: item.isBlueVerified === true || item.isVerified === true,
      // `apidojo/twitter-user-scraper` reports the account's rest id as `id`.
      platformAccountId: pickId(item, ['id', 'id_str', 'rest_id', 'userId']),
    });
  }

  return accounts.map((a) => byHandle.get(a.handleNormalized)).filter((r): r is ScrapeResult => !!r);
}

/** Projected spend for a batch, so the cron can log what it just cost. */
export function estimateCost(counts: Record<GrowthPlatform, number>): number {
  return counts.facebook * UNIT_COST.facebook + counts.twitter * UNIT_COST.twitter;
}

// ─── Writes ──────────────────────────────────────────────────────────

/**
 * Record one day's readings.
 *
 * `latest`/`previous` on the account document are denormalized copies so a list
 * view renders a day-over-day delta without reading any series document.
 * `previous` only shifts when the day key actually changes — re-running for the
 * same day (a retry, or an add on the day the cron already ran) overwrites
 * today's reading rather than shifting yesterday's out of the window.
 *
 * The series write is a nested `merge` into `days.<key>`, so a year document
 * accumulates without ever being read first.
 */
export async function recordSnapshots(
  results: Array<{ accountId: string; result: ScrapeResult }>,
  dayKey: string,
): Promise<void> {
  if (results.length === 0) return;

  const refs = results.map((r) => adminDb.collection(GROWTH_ACCOUNTS).doc(r.accountId));
  const existing = await adminDb.getAll(...refs);
  const batch = adminDb.batch();
  const now = FieldValue.serverTimestamp();

  results.forEach(({ result }, i) => {
    const current = existing[i].data() as { latest?: { date?: string } } | undefined;
    const latest = { ...result.snapshot, date: dayKey };
    const sameDay = current?.latest?.date === dayKey;

    batch.set(refs[i], {
      latest,
      // Re-recording today must not push yesterday out of `previous`.
      ...(sameDay ? {} : { previous: current?.latest ?? null }),
      ...(result.profilePictureUrl ? { profilePictureUrl: result.profilePictureUrl } : {}),
      // Written only when the actor reported one: a night whose payload omitted
      // the id must leave the stored id alone rather than blanking it.
      ...(result.platformAccountId ? { platformAccountId: result.platformAccountId } : {}),
      isVerified: result.isVerified,
      lastScrapeAt: now,
      lastScrapeStatus: 'ok',
      lastScrapeError: null,
    }, { merge: true });

    batch.set(
      refs[i].collection(GROWTH_SERIES_SUB).doc(seriesDocIdFor(dayKey)),
      { days: { [dayKey]: result.snapshot } },
      { merge: true },
    );
  });

  await batch.commit();
}

/**
 * Mark accounts the scrape did not return.
 *
 * `latest` is deliberately left untouched: a failed night means "we do not know
 * today's number", not "the account dropped to zero". The page reads the status
 * and says so, and the chart simply has a gap — which is the truth.
 */
export async function recordScrapeFailures(
  accountIds: string[],
  error: string,
): Promise<void> {
  if (accountIds.length === 0) return;
  const batch = adminDb.batch();
  for (const id of accountIds) {
    batch.set(adminDb.collection(GROWTH_ACCOUNTS).doc(id), {
      lastScrapeAt: FieldValue.serverTimestamp(),
      lastScrapeStatus: 'failed',
      lastScrapeError: error.slice(0, 500),
    }, { merge: true });
  }
  await batch.commit();
}

// ─── Reads / serialization ───────────────────────────────────────────

export function serializeGrowthAccount(doc: DocumentSnapshot): GrowthAccount {
  const d = doc.data() ?? {};
  return {
    id: doc.id,
    platform: (d.platform as GrowthPlatform) ?? 'twitter',
    handle: (d.handle as string) ?? '',
    handleNormalized: (d.handleNormalized as string) ?? '',
    profileUrl: (d.profileUrl as string) ?? '',
    // Normalised on the way out, so a category written by the import script, by
    // hand in the console, or by an older shape all resolve to the closed set —
    // and anything outside it reads as "unfiled" rather than as a sixth colour.
    category: normalizeCategory(d.category),
    platformAccountId: (d.platformAccountId as string) ?? null,
    isActive: d.isActive !== false,
    profilePictureUrl: (d.profilePictureUrl as string) ?? null,
    isVerified: d.isVerified === true,
    latest: (d.latest as GrowthAccount['latest']) ?? null,
    previous: (d.previous as GrowthAccount['previous']) ?? null,
    lastScrapeAt: serializeTimestamp(d.lastScrapeAt as Timestamp | null),
    lastScrapeStatus: (d.lastScrapeStatus as GrowthAccount['lastScrapeStatus']) ?? null,
    lastScrapeError: (d.lastScrapeError as string) ?? null,
    trackPosts: d.trackPosts === true,
    lastPostDiscoveryAt: serializeTimestamp(d.lastPostDiscoveryAt as Timestamp | null),
    lastPostDiscoveryStatus: (d.lastPostDiscoveryStatus as GrowthAccount['lastPostDiscoveryStatus']) ?? null,
    lastPostDiscoveryError: (d.lastPostDiscoveryError as string) ?? null,
    postsWindowSaturated: d.postsWindowSaturated === true,
    lastManualRefreshAt: serializeTimestamp(d.lastManualRefreshAt as Timestamp | null),
    addedBy: (d.addedBy as string) ?? '',
    addedTime: serializeTimestamp(d.addedTime as Timestamp | null),
  };
}

/**
 * The manual-refresh window. Defined in the pure module so the button can render
 * its own disabled state without importing `firebase-admin`; re-exported here so
 * the route reads it from the same place as everything else it needs.
 */
export { MANUAL_REFRESH_COOLDOWN_MS } from '@/lib/growth/metrics';

/** One account by id, or `null`. */
export async function getGrowthAccount(id: string): Promise<GrowthAccount | null> {
  const doc = await adminDb.collection(GROWTH_ACCOUNTS).doc(id).get();
  return doc.exists ? serializeGrowthAccount(doc) : null;
}

/**
 * Start this account's manual-refresh cooldown.
 *
 * Stamped whether or not the scrapes resolved anything, for the same reason the
 * post sync route stamps a post it failed to read: the actors ran and the call
 * was billed either way, so a failure must not become a free retry loop.
 */
export async function stampManualRefresh(id: string): Promise<void> {
  await adminDb.collection(GROWTH_ACCOUNTS).doc(id).set(
    { lastManualRefreshAt: FieldValue.serverTimestamp() },
    { merge: true },
  );
}

/** Every tracked account, active and stopped alike, name-sorted. */
export async function listGrowthAccounts(): Promise<GrowthAccount[]> {
  const snap = await adminDb.collection(GROWTH_ACCOUNTS).get();
  return snap.docs
    .map(serializeGrowthAccount)
    .sort((a, b) => a.handle.localeCompare(b.handle));
}

/**
 * Series for the given accounts across the given years.
 *
 * One `adminDb.getAll()` over `accounts × years` — at the seed list and a
 * two-year history that is 24 reads for the whole page, and it stays flat as
 * history deepens because a year is one document. This is the entire reason the
 * series is a day-keyed map rather than a document per day (rule 9).
 */
export async function readGrowthSeries(
  accountIds: string[],
  years: string[],
): Promise<GrowthSeries[]> {
  if (accountIds.length === 0 || years.length === 0) return [];

  const refs = accountIds.flatMap((id) =>
    years.map((year) =>
      adminDb.collection(GROWTH_ACCOUNTS).doc(id).collection(GROWTH_SERIES_SUB).doc(year),
    ),
  );
  const docs = await adminDb.getAll(...refs);

  const byAccount = new Map<string, GrowthSeries>(
    accountIds.map((id) => [id, { accountId: id, days: {} }]),
  );
  docs.forEach((doc, i) => {
    if (!doc.exists) return;
    const accountId = accountIds[Math.floor(i / years.length)];
    const days = (doc.data()?.days ?? {}) as Record<string, GrowthSnapshot>;
    Object.assign(byAccount.get(accountId)!.days, days);
  });

  return [...byAccount.values()];
}

/** The calendar years a day-key range spans — which series documents to read. */
export function yearsBetween(from: string | null, to: string): string[] {
  const end = Number(to.slice(0, 4));
  // "All time" cannot look further back than the data goes. The hand-collected
  // history starts in 2026, so that is the floor; widen it only if older data
  // is ever imported.
  const start = from ? Number(from.slice(0, 4)) : 2026;
  const years: string[] = [];
  for (let y = Math.min(start, end); y <= end; y++) years.push(String(y));
  return years;
}

/** Today's UTC day key — the key the cron writes under. */
export function currentDayKey(): string {
  return utcDayKey(new Date());
}

export { growthAccountId };

/**
 * Shared with `growthPostsService.ts`, which owns the tweet actor.
 *
 * The raw runner and the two field probes are re-exported rather than copied so
 * the two Growth Tracking actors cannot drift on error handling or on the
 * "a number may arrive as a string" assumption. Everything else stays private:
 * the follower actors, their inputs and their cost rules live only in this file.
 */
export { runActor as runApifyActor, num as apifyNum, str as apifyStr };
