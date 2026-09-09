import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { handleApiError } from '@/lib/middleware/apiHelpers';
import { listGrowthAccounts } from '@/lib/services/growthTrackingService';
import {
  checkSpendCeiling,
  discoverPostsForAccounts,
  estimatePostCost,
  recordPostFailures,
  recordPostReadings,
  recordSpend,
  runTweetLookup,
  selectPostsForRefresh,
  type PostReading,
  type ScrapedPost,
} from '@/lib/services/growthPostsService';

/**
 * Two scraper calls at 10–30s each, plus the Firestore writes for both. A slow
 * actor can sit well past that, and losing a cycle's readings to a lambda
 * timeout is worse than paying for a long invocation.
 */
export const maxDuration = 300;

/**
 * How often an opted-in account's timeline is searched for new posts. Once a
 * day: discovery pays the actor's 20-result floor **per account**, so this is
 * the single most expensive knob in the feature — halving it doubles the largest
 * line on the bill.
 *
 * Deliberately a per-account elapsed-time check rather than "run on the midnight
 * invocation", so the cadence does not silently change if the cron schedule
 * does. 20 rather than 24 so a run that starts a few minutes late does not push
 * discovery a whole cycle out.
 */
const DISCOVERY_INTERVAL_HOURS = 20;

/**
 * Accounts searched in one run. Bounds a single run's discovery spend at
 * 25 × 20 × $0.00025 = $0.125 whatever the roster has grown to; anything left
 * over is picked up by the next run, since the per-account timer is what decides
 * who is due.
 */
const MAX_DISCOVERY_ACCOUNTS = 25;

/**
 * GET /api/cron/growth-posts — the post refresh cycle.
 *
 * Scheduled in `src/vercel.json`. Runs more often than the nightly follower
 * scrape because a post's engagement moves in hours while a follower count moves
 * in days — but it does **not** spend more often: what a run actually costs is
 * decided by the refresh ladder in `postMetrics.ts`, not by how often this fires.
 * A run with nothing due makes no scraper call at all and bills nothing.
 *
 * ── Two passes, two call shapes ─────────────────────────────────────────────
 * 1. DISCOVERY — one search run covering every account due, `from:handle` per
 *    term. Finds new posts *and* delivers a full reading for each in the same
 *    billed result, so a post inside an account's newest-20 window is refreshed
 *    for free and never reaches pass 2.
 * 2. REFRESH — one `tweetIDs` batch for posts whose ladder rung has come due,
 *    padded up to the actor's 20-result floor with the stalest tracked posts
 *    because that floor is billed either way.
 *
 * ── Partial failure is the normal case ──────────────────────────────────────
 * The passes are independent and a failure in one must not discard the other's
 * readings. A post the scraper does not return keeps its previous numbers and is
 * stamped `failed` — a missed reading is a gap, which is true, rather than a
 * collapse to zero, which is not.
 */
export async function GET() {
  // Read through `headers()` rather than off a `NextRequest`. `cacheComponents`
  // is on, which bans the `dynamic` segment config *and* prerenders a route
  // handler touching no request-scoped API — this one would otherwise build as
  // static and every cron invocation would receive a cached copy of the
  // build-time 404, so the refresh would silently never run. (Same reasoning as
  // /api/cron/growth-tracking.)
  const authorization = (await headers()).get('authorization');

  // Fail closed when CRON_SECRET is unset: an open endpoint that spends money on
  // a third-party API is not something to leave running because a variable was
  // forgotten. The 404 is opaque on purpose — it must not tell a prober whether
  // the secret exists or merely differs — so the two causes are separated in the
  // server log, which the caller never sees.
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error(
      '[cron/growth-posts] CRON_SECRET is not set for this deployment, so the job refused to ' +
      'run. Set it in Project → Settings → Environment Variables (Production) and redeploy — ' +
      'env changes do not reach deployments that already exist.',
    );
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  if (authorization !== `Bearer ${secret}`) {
    console.error(
      `[cron/growth-posts] Rejected a request whose Authorization header did not match ` +
      `CRON_SECRET (header ${authorization ? 'present but wrong' : 'absent'}).`,
    );
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  try {
    // The money breaker comes first, before anything can spend. Unlike the two
    // count-based ceilings this one catches volume nobody chose.
    const { blocked, ledger } = await checkSpendCeiling();
    if (blocked) {
      console.error(
        `[cron/growth-posts] REFUSING TO RUN — $${ledger.usd.toFixed(2)} spent this month ` +
        `across ${ledger.runs} runs, at or over the ceiling. Nothing was scraped and nothing ` +
        `was billed. Raise MONTHLY_SPEND_CEILING_USD deliberately, or wait for the month to roll.`,
      );
      return NextResponse.json({ skipped: 'spend-ceiling', spentUsd: ledger.usd }, { status: 200 });
    }

    const now = new Date();
    let billedResults = 0;

    // ── Pass 1: discovery ───────────────────────────────────────────────────
    const accounts = await listGrowthAccounts();
    const dueForDiscovery = accounts
      .filter((a) => a.isActive && a.trackPosts && a.platform === 'twitter')
      .filter((a) => {
        if (!a.lastPostDiscoveryAt) return true;
        const elapsed = now.getTime() - Date.parse(a.lastPostDiscoveryAt);
        return elapsed >= DISCOVERY_INTERVAL_HOURS * 3_600_000;
      })
      .slice(0, MAX_DISCOVERY_ACCOUNTS);

    // The search itself lives in the service, shared with the Track-posts
    // toggle. A discovery failure is contained there and every account is
    // stamped either way, so the refresh pass below still runs — it must not
    // lose readings it is about to pay for because a search failed.
    const discovery = await discoverPostsForAccounts(dueForDiscovery, now);
    billedResults += discovery.billedResults;
    if (discovery.error) {
      console.error('[cron/growth-posts] discovery pass failed:', discovery.error);
    }

    // ── Pass 2: refresh ─────────────────────────────────────────────────────
    // Posts discovery just read are excluded: their reading is already recorded
    // and `nextRefreshAt` already advanced, so re-requesting them would be paying
    // twice for the same number (rule 4).
    const { batch, due, padded } = await selectPostsForRefresh();
    const toRefresh = batch.filter((p) => !discovery.discoveredIds.has(p.id));

    let refreshed = 0;
    let failed = 0;

    if (toRefresh.length > 0) {
      const call = await runTweetLookup(toRefresh.map((p) => p.id));
      await recordSpend(call.billedResults);
      billedResults += call.billedResults;

      const byId = new Map<string, ScrapedPost>(call.results.map((p) => [p.tweetId, p]));
      const readings: PostReading[] = [];
      const missing: Array<{ id: string; postedAt: string | null }> = [];

      for (const post of toRefresh) {
        const scraped = byId.get(post.id);
        if (scraped) readings.push({ post: scraped, existing: post });
        else missing.push({ id: post.id, postedAt: post.postedAt });
      }

      await recordPostReadings(readings, now);
      // A missing post keeps its readings but still advances its schedule, so a
      // deleted post cannot pin the batch and be re-requested on every run.
      await recordPostFailures(
        missing,
        'The scraper returned nothing for this post. It may have been deleted, or the account may have been made private.',
        now,
      );

      refreshed = readings.length;
      failed = missing.length;
    }

    const cost = estimatePostCost(billedResults);
    console.log(
      `[cron/growth-posts] discovery ${dueForDiscovery.length} account(s) → ${discovery.created} new, ` +
      `${discovery.refreshed} free reading(s); refresh ${due.length} due + ${padded.length} padded → ` +
      `${refreshed} read, ${failed} failed; billed ${billedResults} result(s), ` +
      `est. cost $${cost.toFixed(4)}`,
    );

    return NextResponse.json({
      discoveredAccounts: dueForDiscovery.length,
      postsCreated: discovery.created,
      freeReadings: discovery.refreshed,
      due: due.length,
      padded: padded.length,
      refreshed,
      failed,
      billedResults,
      estimatedCostUsd: Number(cost.toFixed(4)),
    });
  } catch (error) {
    return handleApiError(error, 'GET /api/cron/growth-posts');
  }
}
