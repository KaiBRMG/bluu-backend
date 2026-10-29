import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { handleApiError } from '@/lib/middleware/apiHelpers';
import { sweepMirrors } from '@/lib/training/mirror';

/**
 * GET /api/cron/training-mirror — the daily retry of the Storage → Drive mirror.
 *
 * A candidate's upload is copied to the shared drive right after it lands. When
 * that copy fails — Drive quota, a network blip, a function cut off mid-stream —
 * the file is marked `failed` and shows on the roster with a Retry. This catches
 * what nobody retried, and writes the task record of any attempt that has ended.
 *
 * It lives here rather than in `functions/` because it imports the Drive client
 * and the training model from `src/lib` (see the hub's system map). It does not
 * send a notification.
 *
 * Capped per run: a Vercel function has a wall clock, and a backlog is better
 * finished across several days than left half-committed by a timeout.
 */
export const maxDuration = 300;

export async function GET() {
  const authorization = (await headers()).get('authorization');

  // Fail **closed** when CRON_SECRET is unset: this writes to the shared drive.
  const secret = process.env.CRON_SECRET;
  if (!secret || authorization !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    return NextResponse.json({ ok: true, ...(await sweepMirrors()) });
  } catch (error) {
    return handleApiError(error, 'training-mirror cron');
  }
}
