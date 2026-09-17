import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { handleApiError } from '@/lib/middleware/apiHelpers';
import {
  MANUAL_REFRESH_COOLDOWN_MS,
  checkGrowthAccess,
  currentDayKey,
  getGrowthAccount,
  recordScrapeFailures,
  recordSnapshots,
  runFacebookScrape,
  runTwitterScrape,
  stampManualRefresh,
} from '@/lib/services/growthTrackingService';
import {
  MAX_REFRESH_PER_RUN,
  MIN_BILLED_RESULTS,
  checkSpendCeiling,
  listPostsForAccount,
  recordPostFailures,
  recordPostReadings,
  recordSpend,
  runTweetLookup,
  stalestPostsForPadding,
  stampManualSyncMany,
  type PostReading,
} from '@/lib/services/growthPostsService';
import type { GrowthPost } from '@/types/firestore';
import type { DecodedIdToken } from 'firebase-admin/auth';

/**
 * Two scraper calls, run concurrently — see below. 120s rather than the single
 * scrape's 60 buys headroom for the slower of the pair, not for their sum.
 */
export const maxDuration = 120;

/**
 * POST /api/smm/growth/accounts/[id]/refresh — read this account now.
 *
 * ═══ THIS ROUTE SPENDS ON TWO SEPARATE BILLS ════════════════════════════════
 * One profile-actor run (~$0.004 for X, ~$0.010 for a Facebook page) **and**
 * one tweet-actor run (a floor of 20 billed results, ~$0.005) for the account's
 * tracked posts. Roughly 1.5¢ a click, against a subsystem that runs at about
 * $11/month in total. Four things hold that line and each is easy to undo:
 *
 *  1. **The cooldown is server-side.** `lastManualRefreshAt` lives on the
 *     document and is what a second request is refused against. A timer in the
 *     renderer is a suggestion anyone can skip from a console, and every skip is
 *     two actor runs (cross-cutting rule 10).
 *  2. **The stamp lands whether or not anything resolved.** The actors ran; the
 *     call was billed. A failure that left the cooldown unset would be a free
 *     retry loop over a paid API.
 *  3. **The post call is padded to the floor, never sent under it.** The tweet
 *     actor bills a minimum of 20 results whatever the batch size, so an account
 *     with three posts asks for those three plus the seventeen stalest posts on
 *     the roster — which get a free reading. Sending three would cost exactly
 *     the same and collect a sixth of the data.
 *  4. **`MAX_REFRESH_PER_RUN` caps the other end**, so an account that has
 *     accumulated hundreds of tracked posts cannot turn one click into a
 *     hundred-result bill.
 *
 * ── The two calls run concurrently, and settle independently ────────────────
 * They are different actors writing different collections with nothing shared
 * between them, so there is no ordering to preserve and `Promise.allSettled`
 * keeps the wall clock at the slower of the two rather than their sum. It also
 * makes partial success a first-class outcome: followers can land while the post
 * read fails, or the reverse, and the response says which — a single
 * try/catch would have thrown away the half that worked.
 *
 * ── The spend ceiling stops the posts, not the followers ────────────────────
 * `checkSpendCeiling` guards the tweet actor's monthly ledger specifically. The
 * profile actors are a different bill with no ledger, so a month that has hit
 * its post ceiling still refreshes followers and says why the posts were
 * skipped. Refusing the whole request would withhold something the ceiling was
 * never protecting.
 */
export const POST = withAuth(async (
  _request: NextRequest,
  token: DecodedIdToken,
  params: Promise<{ id: string }>,
) => {
  try {
    const denied = await checkGrowthAccess(token.uid);
    if (denied) return denied;

    const { id } = await params;
    const account = await getGrowthAccount(id);
    if (!account) return NextResponse.json({ error: 'Account not found' }, { status: 404 });

    // Stopping an account is the instruction to stop spending on it — the whole
    // difference between stopping and deleting. Refused here and not only in the
    // renderer: a disabled button is an affordance, and this one guards two
    // billed actor runs (rule 10).
    if (!account.isActive) {
      return NextResponse.json({
        error: `Tracking is stopped for @${account.handle}, so nothing is being spent on it. Resume it from Manage accounts to read it again.`,
      }, { status: 409 });
    }

    if (account.lastManualRefreshAt) {
      const elapsed = Date.now() - Date.parse(account.lastManualRefreshAt);
      if (elapsed < MANUAL_REFRESH_COOLDOWN_MS) {
        const waitMinutes = Math.ceil((MANUAL_REFRESH_COOLDOWN_MS - elapsed) / 60_000);
        return NextResponse.json({
          error: `@${account.handle} was refreshed by hand less than ${Math.round(MANUAL_REFRESH_COOLDOWN_MS / 60_000)} minutes ago. Try again in ${waitMinutes} minute${waitMinutes === 1 ? '' : 's'} — neither followers nor engagement move enough in that window to be worth paying for another read.`,
          retryAfterMs: MANUAL_REFRESH_COOLDOWN_MS - elapsed,
        }, { status: 429 });
      }
    }

    // ── What the post half of the call will ask for ──────────────────────
    const { blocked: postsBlocked } = await checkSpendCeiling();
    const tracked = postsBlocked
      ? []
      : (await listPostsForAccount(account.id, account.handleNormalized))
        .filter((p) => p.isActive)
        .slice(0, MAX_REFRESH_PER_RUN);

    const padding = tracked.length > 0 && tracked.length < MIN_BILLED_RESULTS
      ? await stalestPostsForPadding(MIN_BILLED_RESULTS - tracked.length, tracked.map((p) => p.id))
      : [];
    const requested: GrowthPost[] = [...tracked, ...padding];

    const [profile, tweets] = await Promise.allSettled([
      account.platform === 'facebook'
        ? runFacebookScrape([{
          handleNormalized: account.handleNormalized,
          profileUrl: account.profileUrl,
        }])
        : runTwitterScrape([{
          handleNormalized: account.handleNormalized,
          handle: account.handle,
        }]),
      requested.length > 0
        ? runTweetLookup(requested.map((p) => p.id))
        : Promise.resolve(null),
    ]);

    // ── Followers ────────────────────────────────────────────────────────
    let followersRead = false;
    if (profile.status === 'fulfilled' && profile.value[0]) {
      await recordSnapshots([{ accountId: account.id, result: profile.value[0] }], currentDayKey());
      followersRead = true;
    } else {
      // `latest` is deliberately left alone by `recordScrapeFailures`: a failed
      // read means "we do not know today's number", not "it dropped to zero".
      await recordScrapeFailures(
        [account.id],
        profile.status === 'rejected'
          ? 'The follower scrape failed on a manual refresh.'
          : 'The scraper returned nothing for this account on a manual refresh. It may have been renamed, or made private.',
      );
    }

    // ── Posts ────────────────────────────────────────────────────────────
    let postsRead = 0;
    let refreshedAlongside = 0;
    let postsError: string | null = null;

    if (tweets.status === 'rejected') {
      postsError = 'The post scrape failed. Follower history is unaffected, and the next scheduled read will try again.';
    } else if (tweets.value) {
      const call = tweets.value;
      await recordSpend(call.billedResults);

      const byId = new Map(call.results.map((p) => [p.tweetId, p]));
      const readings: PostReading[] = [];
      for (const existing of requested) {
        const scraped = byId.get(existing.id);
        if (scraped) readings.push({ post: scraped, existing });
      }
      await recordPostReadings(readings);

      const missed = tracked.filter((p) => !byId.has(p.id));
      await recordPostFailures(
        missed.map((p) => ({ id: p.id, postedAt: p.postedAt })),
        'The scraper returned nothing for this post. It may have been deleted, or the account may have been made private.',
      );

      // Only what was asked for: a padded post got a reading it did not request,
      // and locking its own button because of that would be charging it for
      // someone else's call.
      await stampManualSyncMany(tracked.map((p) => p.id));

      postsRead = tracked.filter((p) => byId.has(p.id)).length;
      refreshedAlongside = readings.length - postsRead;
    }

    // Always, and last: the actors ran, so the window starts regardless of what
    // came back (see rule 2 at the top).
    await stampManualRefresh(account.id);

    return NextResponse.json({
      success: followersRead || postsRead > 0,
      account: await getGrowthAccount(account.id),
      followersRead,
      postsRead,
      trackedPosts: tracked.length,
      refreshedAlongside,
      postsSkipped: postsBlocked
        ? 'This month’s post-refresh ceiling has been reached, so only followers were read.'
        : postsError,
    });
  } catch (error) {
    return handleApiError(error, 'POST /api/smm/growth/accounts/[id]/refresh');
  }
});
