/**
 * POST /api/time-tracking/screenshots/upload — LEGACY base64 relay.
 *
 * The PNGs arrive as base64 in the JSON body and this function writes them to
 * Storage: a 33% tax on bytes that should never cross Vercel (rule 9i). Current
 * renderers use `/upload-url` + `/finalize` and only fall back here when a
 * signed PUT fails; the route stays for renderers loaded before that shipped
 * (rule 9c). It records the same metadata as `/finalize`.
 */
import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { getUserById } from '@/lib/services/userService';
import { MAX_SCREENS_PER_CAPTURE, saveScreenshots } from '@/lib/services/screenshotService';
import { afterCapture, parseCaptureMeta } from '@/lib/services/captureMeta';
import type { DecodedIdToken } from 'firebase-admin/auth';

const MAX_BASE64_LENGTH = 10 * 1024 * 1024; // ~10MB per screen

export const POST = withAuth(async (request: NextRequest, token: DecodedIdToken) => {
  try {
    // Check if screenshots are enabled for this user
    const userData = await getUserById(token.uid);
    if (!userData?.enableScreenshots) {
      return NextResponse.json({ error: 'Screenshots not enabled for this user' }, { status: 403 });
    }

    const body = await request.json();
    const screens: string[] = body.screens;

    if (!Array.isArray(screens) || screens.length === 0) {
      return NextResponse.json({ error: 'Missing screens data' }, { status: 400 });
    }

    if (screens.length > MAX_SCREENS_PER_CAPTURE) {
      return NextResponse.json({ error: `Too many screens (max ${MAX_SCREENS_PER_CAPTURE})` }, { status: 400 });
    }

    for (const screen of screens) {
      if (typeof screen !== 'string' || screen.length > MAX_BASE64_LENGTH) {
        return NextResponse.json({ error: 'Invalid or oversized screenshot data' }, { status: 400 });
      }
    }

    const meta = parseCaptureMeta(body);
    const { ids: screenshotIds, captureGroup } = await saveScreenshots(token.uid, screens, meta.activityPercent, meta.activityMethod);
    if (screenshotIds.length > 0) afterCapture(token.uid, captureGroup, meta, userData.inputMonitoring === true);

    return NextResponse.json({ screenshotIds });
  } catch (error: unknown) {
    console.error('Error uploading screenshot:', error);
    return NextResponse.json({ error: 'Failed to upload screenshot' }, { status: 500 });
  }
});
