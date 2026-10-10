/**
 * POST /api/time-tracking/screenshots/upload-url — sign one upload slot per screen.
 *
 * Step 1 of 2. The renderer PUTs each PNG straight to Cloud Storage with the
 * URLs signed here, then calls `/finalize` — so the bytes never cross Vercel
 * (rule 9i; this replaces the base64 relay that was the standing violation).
 * The paths are server-chosen and embed the user and capture group, so a slot
 * can only ever write the caller's own capture.
 *
 * Not cacheable: every response is a fresh, single-use set of signatures.
 */
import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { handleApiError } from '@/lib/middleware/apiHelpers';
import { getUserById } from '@/lib/services/userService';
import { MAX_SCREENS_PER_CAPTURE, signScreenshotSlots } from '@/lib/services/screenshotService';
import type { DecodedIdToken } from 'firebase-admin/auth';

export const POST = withAuth(async (request: NextRequest, token: DecodedIdToken) => {
  try {
    const userData = await getUserById(token.uid);
    if (!userData?.enableScreenshots) {
      return NextResponse.json({ error: 'Screenshots not enabled for this user' }, { status: 403 });
    }
    const body = await request.json().catch(() => null);
    const count = Number(body?.count);
    if (!Number.isInteger(count) || count < 1 || count > MAX_SCREENS_PER_CAPTURE) {
      return NextResponse.json({ error: `count must be 1–${MAX_SCREENS_PER_CAPTURE}` }, { status: 400 });
    }
    const signed = await signScreenshotSlots(token.uid, count);
    return NextResponse.json(signed, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return handleApiError(error, 'POST /api/time-tracking/screenshots/upload-url');
  }
});
