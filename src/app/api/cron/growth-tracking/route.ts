import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { handleApiError } from '@/lib/middleware/apiHelpers';
import {
  MAX_TRACKED_ACCOUNTS,
  currentDayKey,
  estimateCost,
  listGrowthAccounts,
  recordScrapeFailures,
  recordSnapshots,
  runFacebookScrape,
  runTwitterScrape,
  type ScrapeResult,
} from '@/lib/services/growthTrackingService';
import { growthAccountId } from '@/lib/growth/platform';

/**
 * Two Apify actors at 10–30s each, run in parallel — but a slow actor can sit
 * well past that, and losing a night's readings to a lambda timeout is worse
 * than paying for a long invocation.
 */
export const maxDuration = 300;

/**
 * GET /api/cron/growth-tracking — the nightly follower reading (00:00 UTC).
 *
 * Scheduled by Vercel Cron (`src/vercel.json`) rather than a Cloud Function so
 * it can import the service, the platform parser and the shared types instead of
 * carrying a second copy of all three in `functions/index.js` — where they would
 * drift apart the first time either side changed.
 *
 * ── Cost ────────────────────────────────────────────────────────────────────
 * ~$0.078 a night at the seed list. The rules that keep it there live in
 * `growthTrackingService.ts`; the two that show up here are: exactly TWO actor
 * runs regardless of account count, and the `MAX_TRACKED_ACCOUNTS` breaker below,
 * which refuses to spend rather than quietly billing whatever the collection has
 * grown to.
 *
 * ── Partial failure is the normal case ──────────────────────────────────────
 * `Promise.allSettled`, not `Promise.all`: a Facebook outage must not cost us
 * the X readings that were already paid for. An account the scrape did not
 * return is stamped `failed` and keeps its old `latest` — a night with no
 * reading is a gap in the chart, which is true, rather than a drop to zero,
 * which is not.
 */
export async function GET() {
  // Read through `headers()` rather than off a `NextRequest`. `cacheComponents`
  // is on, which bans the `dynamic` segment config *and* prerenders a route
  // handler touching no request-scoped API — this one would otherwise build as
  // static and every cron invocation would receive a cached copy of the
  // build-time 404, so the scrape would silently never run. `headers()` is a
  // dynamic API, so awaiting it is both how the secret is read and what keeps
  // the route live. (Same reasoning as /api/cron/onlyfans-media-usage.)
  const authorization = (await headers()).get('authorization');

  // Fail closed when CRON_SECRET is unset: an open endpoint that spends money on
  // a third-party API is not something to leave running because a variable was
  // forgotten.
  const secret = process.env.CRON_SECRET;
  if (!secret || authorization !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  try {
    const accounts = (await listGrowthAccounts()).filter((a) => a.isActive);

    if (accounts.length > MAX_TRACKED_ACCOUNTS) {
      console.error(
        `[cron/growth-tracking] REFUSING TO RUN — ${accounts.length} active accounts exceeds the ` +
        `MAX_TRACKED_ACCOUNTS ceiling of ${MAX_TRACKED_ACCOUNTS}. Nothing was scraped and nothing ` +
        `was billed. Stop tracking accounts, or raise the ceiling deliberately.`,
      );
      return NextResponse.json({ skipped: 'account-ceiling', active: accounts.length }, { status: 200 });
    }

    const facebook = accounts.filter((a) => a.platform === 'facebook');
    const twitter = accounts.filter((a) => a.platform === 'twitter');

    if (facebook.length === 0 && twitter.length === 0) {
      return NextResponse.json({ recorded: 0, note: 'no active accounts' });
    }

    const [fbOutcome, twOutcome] = await Promise.allSettled([
      runFacebookScrape(facebook.map((a) => ({
        handleNormalized: a.handleNormalized,
        profileUrl: a.profileUrl,
      }))),
      runTwitterScrape(twitter.map((a) => ({
        handleNormalized: a.handleNormalized,
        handle: a.handle,
      }))),
    ]);

    const dayKey = currentDayKey();
    const recorded: Array<{ accountId: string; result: ScrapeResult }> = [];
    const failures: Array<{ accountId: string; error: string }> = [];

    const collect = (
      platform: 'facebook' | 'twitter',
      expected: typeof accounts,
      outcome: PromiseSettledResult<ScrapeResult[]>,
    ) => {
      if (outcome.status === 'rejected') {
        // The whole run failed, so every account in it is unknown tonight.
        const error = outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason);
        console.error(`[cron/growth-tracking] ${platform} run failed:`, error);
        for (const a of expected) failures.push({ accountId: a.id, error });
        return;
      }
      const returned = new Set(outcome.value.map((r) => r.handleNormalized));
      for (const result of outcome.value) {
        recorded.push({ accountId: growthAccountId(platform, result.handleNormalized), result });
      }
      // A run can succeed while omitting individual accounts — a page that was
      // renamed, went private, or was deleted. Those are per-account failures,
      // and the manage tab shows the reason so someone can act on it.
      for (const a of expected) {
        if (!returned.has(a.handleNormalized)) {
          failures.push({ accountId: a.id, error: 'The scraper returned no data for this account. It may have been renamed, made private, or removed.' });
        }
      }
    };

    collect('facebook', facebook, fbOutcome);
    collect('twitter', twitter, twOutcome);

    await recordSnapshots(recorded, dayKey);
    // Grouped by message so identical failures share one batch pass.
    for (const message of new Set(failures.map((f) => f.error))) {
      await recordScrapeFailures(
        failures.filter((f) => f.error === message).map((f) => f.accountId),
        message,
      );
    }

    const cost = estimateCost({ facebook: facebook.length, twitter: twitter.length });
    console.log(
      `[cron/growth-tracking] ${dayKey}: recorded ${recorded.length}, failed ${failures.length}, ` +
      `est. cost $${cost.toFixed(3)}`,
    );

    return NextResponse.json({
      date: dayKey,
      recorded: recorded.length,
      failed: failures.length,
      estimatedCostUsd: Number(cost.toFixed(3)),
    });
  } catch (error) {
    return handleApiError(error, 'GET /api/cron/growth-tracking');
  }
}
