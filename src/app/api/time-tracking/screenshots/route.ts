import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { getUserById } from '@/lib/services/userService';
import { getScreenshotsByDate, getScreenshotUrl, ScreenshotRow } from '@/lib/services/screenshotService';
import type { DecodedIdToken } from 'firebase-admin/auth';

export const GET = withAuth(async (request: NextRequest, token: DecodedIdToken) => {
  try {
    const { searchParams } = new URL(request.url);
    const userId   = searchParams.get('userId');
    const date     = searchParams.get('date');
    // Viewer's IANA timezone — used to interpret the calendar date correctly.
    // Defaults to UTC so the API stays backward-compatible.
    const timezone = searchParams.get('timezone') || 'UTC';

    if (!userId || !date) {
      return NextResponse.json({ error: 'userId and date required' }, { status: 400 });
    }

    // Validate date format
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: 'Invalid date format. Use YYYY-MM-DD' }, { status: 400 });
    }

    // If querying another user, caller must have shift-management access
    if (userId !== token.uid) {
      const caller = await getUserById(token.uid);
      if (!caller?.permittedPageIds?.includes('shift-management')) {
        return NextResponse.json({ error: 'Access denied' }, { status: 403 });
      }
    }

    const rows = await getScreenshotsByDate(userId, date, timezone);

    // Group by captureGroup
    const groupMap = new Map<string, ScreenshotRow[]>();
    for (const row of rows) {
      const group = groupMap.get(row.captureGroup) || [];
      group.push(row);
      groupMap.set(row.captureGroup, group);
    }

    // Build grouped response with signed URLs
    const groups = await Promise.all(
      Array.from(groupMap.entries()).map(async ([captureGroup, screens]) => {
        screens.sort((a, b) => a.screenIndex - b.screenIndex);

        const screensWithUrls = await Promise.all(
          screens.map(async (ss) => ({
            id: ss.id,
            timestampUTC: ss.timestampUTC,
            url: await getScreenshotUrl(ss.storagePath),
            thumbnailUrl: await getScreenshotUrl(ss.thumbnailPath || ''),
            screenIndex: ss.screenIndex,
          }))
        );

        return {
          captureGroup,
          timestampUTC: screens[0].timestampUTC,
          screenCount: screens.length,
          screens: screensWithUrls,
        };
      })
    );

    return NextResponse.json({ groups });
  } catch (error: unknown) {
    console.error('Error fetching screenshots:', error);
    return NextResponse.json({ error: 'Failed to fetch screenshots' }, { status: 500 });
  }
});
