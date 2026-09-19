import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { handleApiError } from '@/lib/middleware/apiHelpers';
import { sweepExpiredSnips } from '@/lib/services/snipService';

/**
 * GET /api/cron/snip-cleanup — the daily retention sweep.
 *
 * Two jobs, one pass (see `sweepExpiredSnips`):
 *   1. **Expired snips.** Every row past its `expiresAt`, which each snip
 *      carries from its owner's Auto Delete setting at capture time and which is
 *      re-stamped whenever that setting changes.
 *   2. **Abandoned reservations.** An upload slot whose PUT landed but whose
 *      finalise call never arrived — the window closed, the machine slept. Those
 *      are unreachable bytes in the bucket and this is the only thing that
 *      reclaims them.
 *
 * It lives here rather than in `functions/` because it imports the snip service
 * and the retention arithmetic from `src/lib` (see the hub's system map).
 *
 * **The sweep is not what makes retention true.** A row past its expiry stops
 * resolving on the public page and on the image route the moment it is past it,
 * checked on read — this reclaims the storage, which is a separate concern with
 * a day of slack in it. Do not move the expiry check out of the read path on the
 * grounds that a cron exists.
 *
 * Capped per run: a Vercel function has a wall clock, and a backlog is better
 * finished across several days than left half-committed by a timeout.
 */
export async function GET() {
  const authorization = (await headers()).get('authorization');

  // Fail **closed** when CRON_SECRET is unset. This endpoint deletes user data
  // and their storage objects; an unauthenticated caller must not be able to
  // run it, and "the variable is missing" is not a reason to run it anyway.
  const secret = process.env.CRON_SECRET;
  if (!secret || authorization !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await sweepExpiredSnips();
    if (result.expired || result.abandoned) {
      console.log(
        `[snip-cleanup] removed ${result.expired} expired, ${result.abandoned} abandoned`,
      );
    }
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    return handleApiError(error, 'GET /api/cron/snip-cleanup');
  }
}
