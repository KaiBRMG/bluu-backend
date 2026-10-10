/**
 * POST /api/time-tracking/screenshots/finalize — record an uploaded capture.
 *
 * Step 2 of 2 (see `/upload-url`). Body: `{ captureGroup, paths, …meta }` where
 * meta is activity %, its method, the window, and — for users with input
 * monitoring on — screen fingerprints and the input-quality summary
 * (`parseCaptureMeta`). Every path must be a slot of this capture that exists
 * in the bucket; otherwise 400 and nothing is written.
 */
import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { handleApiError } from '@/lib/middleware/apiHelpers';
import { getUserById } from '@/lib/services/userService';
import { finaliseScreenshots } from '@/lib/services/screenshotService';
import { afterCapture, parseCaptureMeta } from '@/lib/services/captureMeta';
import type { DecodedIdToken } from 'firebase-admin/auth';

export const POST = withAuth(async (request: NextRequest, token: DecodedIdToken) => {
  try {
    const userData = await getUserById(token.uid);
    if (!userData?.enableScreenshots) {
      return NextResponse.json({ error: 'Screenshots not enabled for this user' }, { status: 403 });
    }
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body.captureGroup !== 'string' || !Array.isArray(body.paths)) {
      return NextResponse.json({ error: 'captureGroup and paths are required' }, { status: 400 });
    }
    const meta = parseCaptureMeta(body);
    const screenshotIds = await finaliseScreenshots(token.uid, body.captureGroup, body.paths, meta.activityPercent, meta.activityMethod);
    if (!screenshotIds) {
      return NextResponse.json({ error: 'Those uploads do not match this capture' }, { status: 400 });
    }
    afterCapture(token.uid, body.captureGroup, meta, userData.inputMonitoring === true);
    return NextResponse.json({ screenshotIds }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return handleApiError(error, 'POST /api/time-tracking/screenshots/finalize');
  }
});
