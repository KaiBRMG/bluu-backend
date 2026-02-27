import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { getUserById } from '@/lib/services/userService';
import { getLedgerEntriesByDateRange } from '@/lib/services/activeSessionService';
import { sessionToSegments } from '@/lib/utils/sessionSegments';
import type { DecodedIdToken } from 'firebase-admin/auth';
import type { SegmentRow } from '@/lib/utils/sessionSegments';

// ─── Route handler ───────────────────────────────────────────────────

export const GET = withAuth(async (request: NextRequest, token: DecodedIdToken) => {
  try {
    const { searchParams } = new URL(request.url);
    const targetUserId = searchParams.get('userId');
    const startDateStr = searchParams.get('startDate');
    const endDateStr   = searchParams.get('endDate');

    if (!startDateStr || !endDateStr) {
      return NextResponse.json({ error: 'startDate and endDate required' }, { status: 400 });
    }

    const userId = targetUserId || token.uid;

    if (userId !== token.uid) {
      const caller = await getUserById(token.uid);
      if (!caller?.groups?.includes('admin')) {
        return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
      }
    }

    const startDate = new Date(startDateStr);
    const endDate   = new Date(endDateStr);

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      return NextResponse.json({ error: 'Invalid date format' }, { status: 400 });
    }

    const diffDays = (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24);
    if (diffDays > 31 || diffDays < 0) {
      return NextResponse.json({ error: 'Date range must be 0-31 days' }, { status: 400 });
    }

    const endOfDay = new Date(endDate);
    endOfDay.setUTCHours(23, 59, 59, 999);

    const [newEntries, targetUser] = await Promise.all([
      getLedgerEntriesByDateRange(userId, startDate, endOfDay),
      getUserById(userId),
    ]);

    // Decompose each session's event log into segment rows
    const allRows: SegmentRow[] = newEntries.flatMap(e =>
      sessionToSegments(e.id, e.data),
    );

    // Sort by createdTime ascending
    allRows.sort((a, b) =>
      new Date(a.createdTime).getTime() - new Date(b.createdTime).getTime(),
    );

    return NextResponse.json({
      entries: allRows,
      timezone:        targetUser?.timezone        ?? 'UTC',
      timezoneOffset:  targetUser?.timezoneOffset  ?? '+00:00',
      includeIdleTime: targetUser?.includeIdleTime ?? false,
    });
  } catch (error: unknown) {
    console.error('Error fetching time entries:', error);
    return NextResponse.json({ error: 'Failed to fetch entries' }, { status: 500 });
  }
});
