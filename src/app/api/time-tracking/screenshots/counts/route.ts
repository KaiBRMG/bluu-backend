import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { getUserById } from '@/lib/services/userService';
import { getScreenshotCountsByUsers } from '@/lib/services/screenshotService';
import type { DecodedIdToken } from 'firebase-admin/auth';

// GET /api/time-tracking/screenshots/counts?userIds=uid1,uid2,...
export const GET = withAuth(async (request: NextRequest, token: DecodedIdToken) => {
  try {
    const caller = await getUserById(token.uid);
    if (!caller?.permittedPageIds?.includes('shift-management')) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const raw = searchParams.get('userIds');
    if (!raw) {
      return NextResponse.json({ error: 'userIds query param required' }, { status: 400 });
    }

    const userIds = raw.split(',').filter(Boolean);
    const counts = await getScreenshotCountsByUsers(userIds);
    return NextResponse.json({ counts });
  } catch (error: unknown) {
    console.error('Error fetching screenshot counts:', error);
    return NextResponse.json({ error: 'Failed to fetch counts' }, { status: 500 });
  }
});
