import { NextRequest, NextResponse } from 'next/server';
import { adminAuth } from '@/lib/firebase-admin';
import { getUserById } from '@/lib/services/userService';
import { getEntriesByDateRange } from '@/lib/services/timeEntryService';

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Missing authorization token' }, { status: 401 });
    }

    const idToken = authHeader.split('Bearer ')[1];
    const decodedToken = await adminAuth.verifyIdToken(idToken);
    const callerUid = decodedToken.uid;

    const { searchParams } = new URL(request.url);
    const targetUserId = searchParams.get('userId');
    const startDateStr = searchParams.get('startDate');
    const endDateStr = searchParams.get('endDate');

    if (!startDateStr || !endDateStr) {
      return NextResponse.json({ error: 'startDate and endDate required' }, { status: 400 });
    }

    const userId = targetUserId || callerUid;

    // If querying another user, caller must be admin
    if (userId !== callerUid) {
      const caller = await getUserById(callerUid);
      if (!caller?.groups?.includes('admin')) {
        return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
      }
    }

    const startDate = new Date(startDateStr);
    const endDate = new Date(endDateStr);

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      return NextResponse.json({ error: 'Invalid date format' }, { status: 400 });
    }

    const diffDays = (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24);
    if (diffDays > 31 || diffDays < 0) {
      return NextResponse.json({ error: 'Date range must be 0-31 days' }, { status: 400 });
    }

    // Extend endDate to end-of-day so entries created during that day are included
    const endOfDay = new Date(endDate);
    endOfDay.setUTCHours(23, 59, 59, 999);

    const entries = await getEntriesByDateRange(userId, startDate, endOfDay);

    const serialized = entries.map(e => ({
      id: e.id,
      state: e.data.state,
      createdTime: e.data.createdTime?.toDate?.()?.toISOString() ?? null,
      lastTime: e.data.lastTime?.toDate?.()?.toISOString() ?? null,
    }));

    const targetUser = await getUserById(userId);

    return NextResponse.json({
      entries: serialized,
      timezone: targetUser?.timezone || 'UTC',
      timezoneOffset: targetUser?.timezoneOffset || '+00:00',
      includeIdleTime: targetUser?.includeIdleTime ?? false,
    });
  } catch (error: unknown) {
    console.error('Error fetching time entries:', error);
    const errorCode = (error as { code?: string })?.code;
    if (errorCode === 'auth/id-token-expired') {
      return NextResponse.json({ error: 'Session expired' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Failed to fetch entries' }, { status: 500 });
  }
}
