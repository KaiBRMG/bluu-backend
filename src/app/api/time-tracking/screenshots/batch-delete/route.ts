import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { getUserById } from '@/lib/services/userService';
import { deleteScreenshotsByUsersAndDateRange } from '@/lib/services/screenshotService';
import type { DecodedIdToken } from 'firebase-admin/auth';

export const POST = withAuth(async (request: NextRequest, token: DecodedIdToken) => {
  try {
    const caller = await getUserById(token.uid);
    if (!caller?.permittedPageIds?.includes('shift-management')) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const { userIds, startDate, endDate } = await request.json();

    if (!Array.isArray(userIds) || userIds.length === 0) {
      return NextResponse.json({ error: 'userIds must be a non-empty array' }, { status: 400 });
    }
    if (!startDate || !endDate) {
      return NextResponse.json({ error: 'startDate and endDate are required' }, { status: 400 });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
      return NextResponse.json({ error: 'Invalid date format. Use YYYY-MM-DD' }, { status: 400 });
    }
    if (startDate > endDate) {
      return NextResponse.json({ error: 'startDate must be before or equal to endDate' }, { status: 400 });
    }

    const deleted = await deleteScreenshotsByUsersAndDateRange(userIds, startDate, endDate);
    return NextResponse.json({ success: true, deleted });
  } catch (error: unknown) {
    console.error('Error batch deleting screenshots:', error);
    return NextResponse.json({ error: 'Failed to batch delete screenshots' }, { status: 500 });
  }
});
