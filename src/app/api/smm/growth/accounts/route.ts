import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { adminDb } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { handleApiError } from '@/lib/middleware/apiHelpers';
import {
  GROWTH_ACCOUNTS,
  GROWTH_SERIES_SUB,
  MAX_TRACKED_ACCOUNTS,
  checkGrowthAccess,
  currentDayKey,
  growthAccountId,
  listGrowthAccounts,
  runFacebookScrape,
  runTwitterScrape,
  serializeGrowthAccount,
} from '@/lib/services/growthTrackingService';
import {
  GROWTH_PLATFORMS,
  PLATFORM_LABEL,
  parseProfileUrl,
  seriesDocIdFor,
  type GrowthPlatform,
} from '@/lib/growth/platform';
import type { DecodedIdToken } from 'firebase-admin/auth';

/**
 * Adding an account fires a single validating scrape (10–30s), so this route
 * needs more than a default lambda's ten seconds.
 */
export const maxDuration = 60;

/** GET /api/smm/growth/accounts — every tracked account, active and stopped. */
export const GET = withAuth(async (_request: NextRequest, token: DecodedIdToken) => {
  try {
    const denied = await checkGrowthAccess(token.uid);
    if (denied) return denied;

    return NextResponse.json({ accounts: await listGrowthAccounts() });
  } catch (error) {
    return handleApiError(error, 'GET /api/smm/growth/accounts');
  }
});

/**
 * POST /api/smm/growth/accounts — start tracking an account.
 *
 * The add is validated by an immediate single-account scrape (~$0.01) and is
 * **all-or-nothing**: a URL the actor cannot resolve writes nothing at all. A
 * typo must not become a document that fails — and bills — every night forever
 * while quietly showing an empty chart.
 *
 * That scrape doubles as day zero, so a newly added account has a reading
 * straight away instead of waiting for midnight UTC.
 */
export const POST = withAuth(async (request: NextRequest, token: DecodedIdToken) => {
  try {
    const denied = await checkGrowthAccess(token.uid);
    if (denied) return denied;

    const body = await request.json() as { platform?: string; profileUrl?: string };

    const platform = body.platform as GrowthPlatform;
    if (!GROWTH_PLATFORMS.includes(platform)) {
      return NextResponse.json({ error: 'Choose a platform.' }, { status: 400 });
    }

    const parsed = parseProfileUrl(platform, body.profileUrl ?? '');
    if (!parsed) {
      return NextResponse.json({
        error: `That does not look like a ${PLATFORM_LABEL[platform]} profile URL. Paste the link to the page itself, for example ${
          platform === 'facebook' ? 'https://www.facebook.com/adamtwinkx' : 'https://x.com/TwinkLoad'
        }.`,
      }, { status: 400 });
    }

    const id = growthAccountId(platform, parsed.handleNormalized);
    const ref = adminDb.collection(GROWTH_ACCOUNTS).doc(id);

    // Deterministic ids make the duplicate check one read instead of a query.
    const existing = await ref.get();
    if (existing.exists) {
      const account = serializeGrowthAccount(existing);
      return NextResponse.json({
        error: account.isActive
          ? `@${account.handle} is already being tracked.`
          : `@${account.handle} was tracked before. Resume it from the stopped list instead of adding it again — its history is still there.`,
        existingId: id,
        isActive: account.isActive,
      }, { status: 409 });
    }

    // The cost ceiling is checked on the way in, where it can still be refused
    // with an explanation, as well as in the cron.
    const count = (await adminDb.collection(GROWTH_ACCOUNTS).count().get()).data().count;
    if (count >= MAX_TRACKED_ACCOUNTS) {
      return NextResponse.json({
        error: `The tracked-account limit of ${MAX_TRACKED_ACCOUNTS} has been reached. Stop tracking an account first, or raise the limit deliberately — every account adds to the daily scraping cost.`,
      }, { status: 400 });
    }

    // One account, one result — validation and day zero in the same billed call.
    const [result] = platform === 'facebook'
      ? await runFacebookScrape([{ handleNormalized: parsed.handleNormalized, profileUrl: parsed.canonicalUrl }])
      : await runTwitterScrape([{ handleNormalized: parsed.handleNormalized, handle: parsed.handle }]);

    if (!result) {
      return NextResponse.json({
        error: `We could not find ${PLATFORM_LABEL[platform]} account "${parsed.handle}". Check the link opens the page you expect — nothing has been saved.`,
      }, { status: 400 });
    }

    const dayKey = currentDayKey();
    const batch = adminDb.batch();
    batch.set(ref, {
      platform,
      // The sheet's short label ("Adam", "Noah Ryder") is more useful in a
      // legend than the page's own long title, so a typed name wins.
      handle: parsed.handle,
      handleNormalized: parsed.handleNormalized,
      profileUrl: parsed.canonicalUrl,
      isActive: true,
      profilePictureUrl: result.profilePictureUrl,
      isVerified: result.isVerified,
      latest: { ...result.snapshot, date: dayKey },
      previous: null,
      lastScrapeAt: FieldValue.serverTimestamp(),
      lastScrapeStatus: 'ok',
      lastScrapeError: null,
      addedBy: token.uid,
      addedTime: FieldValue.serverTimestamp(),
    });
    batch.set(
      ref.collection(GROWTH_SERIES_SUB).doc(seriesDocIdFor(dayKey)),
      { days: { [dayKey]: result.snapshot } },
      { merge: true },
    );
    await batch.commit();

    return NextResponse.json({ success: true, id });
  } catch (error) {
    return handleApiError(error, 'POST /api/smm/growth/accounts');
  }
});
