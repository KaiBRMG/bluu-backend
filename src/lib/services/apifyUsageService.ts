import { adminDb } from '@/lib/firebase-admin';
import { serializeTimestamp } from '@/lib/middleware/apiHelpers';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import type {
  ApifyActorUsage,
  ApifyDailyUsage,
  ApifyRunSummary,
  ApifyUsageReport,
} from '@/types/firestore';

/**
 * What Apify actually billed us — as opposed to what we predicted it would.
 *
 * ── Why this module exists ──────────────────────────────────────────────────
 * Growth Tracking carries a cost *estimate*: `growth-spend/{YYYY-MM}` counts
 * billed results and multiplies by `UNIT_COST_PER_RESULT`. That figure is a
 * planning number and it is wrong in three ways at once, all of them
 * structural rather than fixable arithmetic:
 *
 *   1. It only counts the **tweet actor**. The nightly Facebook and X profile
 *      scrapes — the larger half of the bill — are never recorded at all.
 *   2. It uses a **guessed unit price**. The store page and the invoice do not
 *      have to agree, and neither is visible from inside our own code.
 *   3. It bills per *result*, while Apify bills per result **plus platform
 *      usage** (compute units, dataset writes, data transfer, proxy). A run
 *      that returns twenty rows and a run that returns twenty rows after
 *      grinding for four minutes cost different amounts.
 *
 * So the estimate cannot be corrected in place; it has to be *replaced* by the
 * platform's own figures. This module reads them.
 *
 * ── The ground truth is the run list, not the usage endpoint ────────────────
 * `GET /v2/users/me/usage/monthly` reports the account total for Apify's own
 * **billing cycle**, which need not start on the 1st, and it does not break
 * down by actor. `GET /v2/actor-runs` returns one row per run with the real
 * `usageTotalUsd` on it, which is both per-call granularity ("what did that
 * refresh cost?") and something we can bucket by calendar month ourselves.
 * The monthly endpoint is fetched anyway, as context: it is the number the
 * invoice is drawn from, and a large gap between the two means runs are being
 * started by something other than this app.
 *
 * ── RULE 9d still holds, and is not violated here ───────────────────────────
 * The prohibition is on *actor runs* — those are billed per result, and a
 * diagnostic loop burns real money. Everything this module calls is account
 * metadata: the run list, the usage summary and `GET /v2/acts/{id}`. Those are
 * free and unmetered. **Do not add a call here that starts a run**, and do not
 * read this module as a licence to poke the API by hand — the ban on
 * hand-running `curl` against `api.apify.com` is unchanged.
 *
 * ── Caching ─────────────────────────────────────────────────────────────────
 * A month is at most a few hundred runs, so a sync is two or three HTTP calls.
 * Still cached in `apify-usage/{YYYY-MM}`, for two reasons: the Tracked-posts
 * strip wants the real figure without paying a network round trip on page load,
 * and a closed month never changes again.
 */

export const APIFY_USAGE = 'apify-usage';
export const APIFY_ACTORS = 'apify-actors';

const API_BASE = 'https://api.apify.com/v2';

/** How long a synced month is served without re-reading the platform. */
export const USAGE_TTL_MS = 15 * 60 * 1000;

/** Run rows kept on the snapshot for the dialog's call log. */
const RECENT_RUNS_KEPT = 60;

/**
 * The actors this app runs, by their full `username/name`, mapped to the label
 * the UI shows. An actor we do not recognise is still reported — under its own
 * name — because an unexpected actor on the bill is exactly the thing this
 * surface exists to reveal.
 */
export const KNOWN_ACTORS: Record<string, string> = {
  'apify/facebook-pages-scraper': 'Facebook pages (followers)',
  'apidojo/twitter-user-scraper': 'X profiles (followers)',
  'kaitoeasyapi/twitter-x-data-tweet-scraper-pay-per-result-cheapest': 'X posts (engagement)',
};

/** The actor whose spend the post-tracking ceiling governs. */
export const TWEET_ACTOR_NAME =
  'kaitoeasyapi/twitter-x-data-tweet-scraper-pay-per-result-cheapest';

function apifyToken(): string {
  const token = process.env.APIFY_API_KEY;
  if (!token) throw new Error('APIFY_API_KEY is not configured');
  return token;
}

/**
 * A metadata GET against the Apify API.
 *
 * The token goes in the `Authorization` header rather than the query string:
 * these URLs end up in error messages and server logs, and a query-string token
 * is a credential written to every one of them (cross-cutting rule 10).
 */
async function apifyGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${apifyToken()}` },
    cache: 'no-store',
  });
  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 300);
    throw new Error(`Apify GET ${path} failed (${res.status}): ${detail}`);
  }
  const body = await res.json();
  return (body?.data ?? body) as T;
}

// ─── Month arithmetic ────────────────────────────────────────────────

/** `YYYY-MM` for a moment, in UTC — the key every figure here is bucketed by. */
export function usageMonthKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 7);
}

/** True for a well-formed `YYYY-MM` no later than the current month. */
export function isValidUsageMonth(month: string): boolean {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return false;
  return month <= usageMonthKey();
}

/** `YYYY-MM` shifted by whole months, in UTC. */
function stepMonthKey(month: string, by: number): string {
  const d = new Date(`${month}-01T00:00:00.000Z`);
  d.setUTCMonth(d.getUTCMonth() + by);
  return d.toISOString().slice(0, 7);
}

function monthBounds(month: string): { from: Date; to: Date } {
  const from = new Date(`${month}-01T00:00:00.000Z`);
  const to = new Date(from);
  to.setUTCMonth(to.getUTCMonth() + 1);
  return { from, to };
}

// ─── Actor name resolution ───────────────────────────────────────────

/**
 * Run rows carry `actId` — an opaque platform id (`nfp1fpt5gUlBwPcor`), not
 * `apidojo/twitter-user-scraper`. Resolving it needs one free metadata call per
 * *distinct* actor, and the mapping is immutable, so it is cached in Firestore
 * forever and in module scope for the life of the lambda.
 *
 * A failed lookup degrades to the raw id rather than throwing: a usage report
 * that cannot name one actor is far better than no report.
 */
const actorNameMemo = new Map<string, string>();

async function resolveActorNames(actIds: string[]): Promise<Map<string, string>> {
  const resolved = new Map<string, string>();
  const missing: string[] = [];

  for (const id of actIds) {
    const memo = actorNameMemo.get(id);
    if (memo) resolved.set(id, memo);
    else missing.push(id);
  }
  if (missing.length === 0) return resolved;

  const cached = await adminDb.getAll(
    ...missing.map((id) => adminDb.collection(APIFY_ACTORS).doc(id)),
  );
  const unknown: string[] = [];
  for (const doc of cached) {
    const name = doc.exists ? (doc.data()?.name as string | undefined) : undefined;
    if (name) {
      resolved.set(doc.id, name);
      actorNameMemo.set(doc.id, name);
    } else {
      unknown.push(doc.id);
    }
  }
  if (unknown.length === 0) return resolved;

  await Promise.all(unknown.map(async (id) => {
    try {
      const act = await apifyGet<{ name?: string; username?: string; title?: string }>(
        `/acts/${id}`,
      );
      const name = act.username && act.name ? `${act.username}/${act.name}` : (act.name ?? id);
      resolved.set(id, name);
      actorNameMemo.set(id, name);
      await adminDb.collection(APIFY_ACTORS).doc(id).set({
        name,
        title: act.title ?? null,
        cachedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    } catch (error) {
      console.warn(`[apify-usage] Could not resolve actor ${id}:`, error);
      resolved.set(id, id);
    }
  }));

  return resolved;
}

// ─── Fetching ────────────────────────────────────────────────────────

interface RawRun {
  id: string;
  actId: string;
  status: string;
  startedAt?: string;
  finishedAt?: string;
  usageTotalUsd?: number | null;
}

/**
 * Every run started inside `[from, to)`, newest first.
 *
 * `startedAfter` / `startedBefore` are sent as a server-side filter *and* the
 * window is re-checked locally. The local check is not redundant: if a future
 * API version ignores or renames those parameters the paging below would
 * otherwise walk the account's entire history and attribute all of it to one
 * month. Paging stops as soon as a page runs off the start of the window,
 * which with `desc` means everything after it is older still.
 */
async function fetchRuns(from: Date, to: Date): Promise<RawRun[]> {
  const runs: RawRun[] = [];
  const limit = 1000;

  for (let offset = 0; offset < 10_000; offset += limit) {
    const page = await apifyGet<{ items?: RawRun[]; total?: number }>(
      `/actor-runs?desc=1&limit=${limit}&offset=${offset}` +
      `&startedAfter=${encodeURIComponent(from.toISOString())}` +
      `&startedBefore=${encodeURIComponent(to.toISOString())}`,
    );
    const items = page.items ?? [];
    if (items.length === 0) break;

    let ranOff = false;
    for (const run of items) {
      const started = run.startedAt ? new Date(run.startedAt) : null;
      if (!started || Number.isNaN(started.getTime())) continue;
      if (started >= to) continue;
      if (started < from) { ranOff = true; continue; }
      runs.push(run);
    }
    if (ranOff || items.length < limit) break;
  }

  return runs;
}

interface RawMonthlyUsage {
  usageCycle?: { startAt?: string; endAt?: string };
  totalUsageCreditsUsdAfterVolumeDiscount?: number;
  totalUsageCreditsUsdBeforeVolumeDiscount?: number;
}

/**
 * Apify's own summary for the billing cycle containing `month`.
 *
 * Deliberately non-fatal: it is context, not the report. If it fails the
 * per-actor breakdown built from the run list is still complete and correct,
 * and the UI simply omits the cycle line.
 */
async function fetchCycle(month: string): Promise<ApifyUsageReport['cycle']> {
  try {
    const { from, to } = monthBounds(month);
    // Mid-month, so a cycle that starts on (say) the 5th is still the cycle the
    // caller means. Asking for the 1st can land in the *previous* cycle.
    const probe = new Date(Math.min(from.getTime() + 14 * 86_400_000, to.getTime() - 1));
    const usage = await apifyGet<RawMonthlyUsage>(
      `/users/me/usage/monthly?date=${probe.toISOString().slice(0, 10)}`,
    );
    const startAt = usage.usageCycle?.startAt;
    const endAt = usage.usageCycle?.endAt;
    if (!startAt || !endAt) return null;
    return {
      startAt,
      endAt,
      creditsUsd:
        usage.totalUsageCreditsUsdAfterVolumeDiscount ??
        usage.totalUsageCreditsUsdBeforeVolumeDiscount ??
        0,
    };
  } catch (error) {
    console.warn('[apify-usage] Monthly usage summary unavailable:', error);
    return null;
  }
}

// ─── Aggregation ─────────────────────────────────────────────────────

function durationSecs(run: RawRun): number | null {
  if (!run.startedAt || !run.finishedAt) return null;
  const ms = new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime();
  return Number.isFinite(ms) && ms >= 0 ? Math.round(ms / 1000) : null;
}

/**
 * Turn raw runs into the report the dialog renders.
 *
 * A run still going has no `usageTotalUsd` yet; it counts as a run at $0 rather
 * than being dropped, so "3 runs today" matches what the log shows. Its cost
 * lands on the next sync — which is one more reason a month is re-synced rather
 * than frozen the moment it is first read.
 */
function buildReport(
  month: string,
  runs: RawRun[],
  names: Map<string, string>,
  cycle: ApifyUsageReport['cycle'],
  comparison: ApifyUsageReport['comparison'],
): Omit<ApifyUsageReport, 'syncedAt' | 'cached' | 'staleReason'> {
  const byActor = new Map<string, ApifyActorUsage>();
  const byDay = new Map<string, ApifyDailyUsage>();
  let totalUsd = 0;

  for (const run of runs) {
    const usd = typeof run.usageTotalUsd === 'number' ? run.usageTotalUsd : 0;
    const actorName = names.get(run.actId) ?? run.actId;
    totalUsd += usd;

    const actor = byActor.get(run.actId) ?? {
      actorId: run.actId,
      actorName,
      label: KNOWN_ACTORS[actorName] ?? null,
      runs: 0,
      failed: 0,
      usd: 0,
    };
    actor.runs += 1;
    if (run.status !== 'SUCCEEDED' && run.status !== 'RUNNING' && run.status !== 'READY') {
      actor.failed += 1;
    }
    actor.usd += usd;
    byActor.set(run.actId, actor);

    const day = (run.startedAt ?? '').slice(0, 10);
    if (day) {
      const bucket = byDay.get(day) ?? { date: day, usd: 0, runs: 0 };
      bucket.usd += usd;
      bucket.runs += 1;
      byDay.set(day, bucket);
    }
  }

  const recentRuns: ApifyRunSummary[] = runs
    .slice(0, RECENT_RUNS_KEPT)
    .map((run) => ({
      id: run.id,
      actorId: run.actId,
      actorName: names.get(run.actId) ?? run.actId,
      status: run.status,
      startedAt: run.startedAt ?? null,
      finishedAt: run.finishedAt ?? null,
      durationSecs: durationSecs(run),
      usd: typeof run.usageTotalUsd === 'number' ? run.usageTotalUsd : 0,
    }));

  return {
    month,
    totalUsd,
    runs: runs.length,
    actors: [...byActor.values()].sort((a, b) => b.usd - a.usd),
    daily: [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date)),
    recentRuns,
    cycle,
    comparison,
  };
}

/**
 * Last month's spend, on the same footing as this month's.
 *
 * A cost figure with nothing to compare it to is a number, not information —
 * the question anyone opening this dialog actually has is "is it going up".
 * But the naive comparison is a lie: seventeen days of September against all
 * of August reads as a 45% saving that nobody made. So two figures are
 * returned, and the UI leads with the second:
 *
 *   `totalUsd`   — last month, complete. The record.
 *   `toDateUsd`  — last month summed only as far into it as we have got into
 *                  this one. The honest comparison.
 *
 * For a month that has already ended the two are identical by construction,
 * because "as far as we have got" is the whole month.
 *
 * Read from the stored snapshot, never from Apify: it costs one document read
 * and the previous month was synced while it was current. If no snapshot
 * exists — the first month after this shipped — the comparison is `null` and
 * the UI says there is nothing to compare against, rather than inventing a
 * baseline of zero and reporting infinite growth.
 */
async function readComparison(month: string): Promise<ApifyUsageReport['comparison']> {
  const previousMonth = stepMonthKey(month, -1);
  const doc = await adminDb.collection(APIFY_USAGE).doc(previousMonth).get();
  if (!doc.exists) return null;

  const d = doc.data() ?? {};
  const totalUsd = (d.totalUsd as number) ?? 0;
  const daily = (d.daily as ApifyDailyUsage[]) ?? [];

  // How far into `month` we have got. A past month is complete, so the whole
  // of the previous month is the like-for-like window.
  const now = new Date();
  const dayReached = month === usageMonthKey(now)
    ? now.getUTCDate()
    : 31;

  const toDateUsd = daily
    .filter((entry) => Number(entry.date.slice(8, 10)) <= dayReached)
    .reduce((sum, entry) => sum + entry.usd, 0);

  return { month: previousMonth, totalUsd, toDateUsd, dayReached };
}

// ─── The snapshot ────────────────────────────────────────────────────

async function readSnapshot(month: string): Promise<ApifyUsageReport | null> {
  const doc = await adminDb.collection(APIFY_USAGE).doc(month).get();
  if (!doc.exists) return null;
  const d = doc.data() ?? {};
  return {
    month,
    totalUsd: (d.totalUsd as number) ?? 0,
    runs: (d.runs as number) ?? 0,
    actors: (d.actors as ApifyActorUsage[]) ?? [],
    daily: (d.daily as ApifyDailyUsage[]) ?? [],
    recentRuns: (d.recentRuns as ApifyRunSummary[]) ?? [],
    cycle: (d.cycle as ApifyUsageReport['cycle']) ?? null,
    comparison: (d.comparison as ApifyUsageReport['comparison']) ?? null,
    syncedAt: serializeTimestamp(d.syncedAt as Timestamp | null) ?? new Date(0).toISOString(),
    cached: true,
    staleReason: null,
  };
}

/**
 * Re-read a month from Apify and store it.
 *
 * Also writes the real figures through to `growth-spend/{YYYY-MM}` so the
 * Tracked-posts strip and the spend breaker can use measured money without
 * either of them making a network call. Two figures land there and they are
 * different on purpose: `actualUsd` is the **tweet actor alone**, which is what
 * the post-tracking ceiling governs, while `actualTotalUsd` is everything Apify
 * billed us that month, which is what a person means by "what are we paying".
 * Charging the follower scrape against the post ceiling would trip a breaker
 * over spending it does not control.
 */
export async function syncApifyUsage(month: string = usageMonthKey()): Promise<ApifyUsageReport> {
  const { from, to } = monthBounds(month);
  const runs = await fetchRuns(from, to);
  const names = await resolveActorNames([...new Set(runs.map((r) => r.actId))]);
  const cycle = await fetchCycle(month);
  // Read before the write below, so a re-sync of the same month compares against
  // last month rather than against the copy of itself it is about to replace.
  const comparison = await readComparison(month);
  const report = buildReport(month, runs, names, cycle, comparison);

  await adminDb.collection(APIFY_USAGE).doc(month).set({
    ...report,
    syncedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  const tweetUsd = report.actors
    .filter((a) => a.actorName === TWEET_ACTOR_NAME)
    .reduce((sum, a) => sum + a.usd, 0);

  await adminDb.collection('growth-spend').doc(month).set({
    month,
    actualUsd: tweetUsd,
    actualTotalUsd: report.totalUsd,
    actualRuns: report.runs,
    actualSyncedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  return { ...report, syncedAt: new Date().toISOString(), cached: false, staleReason: null };
}

/**
 * The report for a month, synced if what we hold is stale.
 *
 * A live fetch that fails falls back to the stored snapshot with the reason
 * attached rather than erroring: Apify being briefly unreachable should not
 * make a cost dialog unopenable, and a figure labelled with when it was taken
 * is honest in a way an error page is not.
 */
export async function getApifyUsage(
  month: string = usageMonthKey(),
  { force = false }: { force?: boolean } = {},
): Promise<ApifyUsageReport> {
  const snapshot = await readSnapshot(month);
  const age = snapshot ? Date.now() - new Date(snapshot.syncedAt).getTime() : Infinity;
  if (!force && snapshot && age < USAGE_TTL_MS) return snapshot;

  try {
    return await syncApifyUsage(month);
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Apify is unreachable';
    if (snapshot) return { ...snapshot, staleReason: reason };
    throw error;
  }
}

/**
 * Best-effort sync from a cron, where usage is a side errand rather than the
 * job. Never throws — a failed reconciliation must not fail a scrape cycle that
 * has already succeeded and already spent the money.
 */
export async function syncApifyUsageQuietly(): Promise<void> {
  try {
    await syncApifyUsage();
  } catch (error) {
    console.warn('[apify-usage] Background sync failed:', error);
  }
}
