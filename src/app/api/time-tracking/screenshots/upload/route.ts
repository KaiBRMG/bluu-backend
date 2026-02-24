import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { getUserById } from '@/lib/services/userService';
import { saveScreenshots } from '@/lib/services/screenshotService';
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

    if (screens.length > 10) {
      return NextResponse.json({ error: 'Too many screens (max 10)' }, { status: 400 });
    }

    for (const screen of screens) {
      if (typeof screen !== 'string' || screen.length > MAX_BASE64_LENGTH) {
        return NextResponse.json({ error: 'Invalid or oversized screenshot data' }, { status: 400 });
      }
    }

    const screenshotIds = await saveScreenshots(token.uid, screens);
    return NextResponse.json({ screenshotIds });
  } catch (error: unknown) {
    console.error('Error uploading screenshot:', error);
    return NextResponse.json({ error: 'Failed to upload screenshot' }, { status: 500 });
  }
});
