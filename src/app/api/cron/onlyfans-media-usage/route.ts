import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { handleApiError } from '@/lib/middleware/apiHelpers';
import { sampleMediaCacheUsage } from '@/lib/services/onlyfansMediaUsage';

/**
 * Totalling a growing prefix is a paged walk over Cloud Storage. Well inside
 * this at any realistic size, but not inside a default lambda's ten seconds once
 * the cache holds tens of thousands of objects.
 */
export const maxDuration = 120;

/**
 * GET /api/cron/onlyfans-media-usage — the daily reading of the media byte cache.
 *
 * Scheduled by Vercel Cron (`vercel.json`) rather than by a Cloud Function,
 * because it has to send a notification and **notification copy lives only in
 * `notificationContent.ts`** — which `functions/` cannot import. Putting the job
 * here keeps the one-copy rule intact instead of working around it.
 *
 * It does two things and no more: append today's reading to the series in
 * `onlyfans-meta/media-usage`, and raise a single lifetime alert if the cache
 * has reached the threshold. Everything about *why* is in
 * `services/onlyfansMediaUsage.ts`.
 */
export async function GET() {
  // Read through `headers()` rather than off a `NextRequest`. `cacheComponents`
  // is on, which bans the `dynamic` segment config *and* prerenders a route
  // handler that touches no request-scoped API — this one otherwise built as
  // static, meaning every cron invocation would have received a cached copy of
  // the 404 produced at build time (when `CRON_SECRET` is not set) and the
  // reading would silently never have been taken. `headers()` is a dynamic API,
  // so awaiting it is both how the secret is read and what keeps the route live.
  const authorization = (await headers()).get('authorization');

  // Vercel Cron sends `Authorization: Bearer $CRON_SECRET` when that env var is
  // set. Fail **closed** when it is not configured: an unauthenticated endpoint
  // that walks a bucket and can write a notification is not something to leave
  // open because a variable was forgotten.
  const secret = process.env.CRON_SECRET;
  if (!secret || authorization !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  try {
    const report = await sampleMediaCacheUsage();
    return NextResponse.json(report);
  } catch (error) {
    return handleApiError(error, 'GET /api/cron/onlyfans-media-usage');
  }
}
