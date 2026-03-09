import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { getUserById } from '@/lib/services/userService';
import { getLedgerEntriesByDateRange } from '@/lib/services/activeSessionService';
import { sessionToSegments } from '@/lib/utils/sessionSegments';
import type { DecodedIdToken } from 'firebase-admin/auth';
import type { SegmentRow } from '@/lib/utils/sessionSegments';

// ─── Timezone-aware date helpers ─────────────────────────────────────

/**
 * Returns a Date representing 00:00:00.000 of `dateStr` (YYYY-MM-DD) in the
 * given IANA timezone. Handles sub-hour offsets and DST by sampling the offset
 * at noon on that day.
 */
function dateToDayStartUTC(dateStr: string, timezone: string): Date {
  const [year, month, day] = dateStr.split('-').map(Number);
  const noonUTC = Date.UTC(year, month - 1, day, 12, 0, 0);
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(new Date(noonUTC));
  const noonH = parseInt(parts.find(p => p.type === 'hour')!.value,   10);
  const noonM = parseInt(parts.find(p => p.type === 'minute')!.value, 10);
  const offsetMs = ((noonH * 60 + noonM) - (12 * 60)) * 60 * 1000;
  return new Date(Date.UTC(year, month - 1, day, 0, 0, 0) - offsetMs);
}

/** Returns a Date representing 23:59:59.999 of `dateStr` in the given timezone. */
function dateToDayEndUTC(dateStr: string, timezone: string): Date {
  const start = dateToDayStartUTC(dateStr, timezone);
  return new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1);
}

// ─── Route handler ───────────────────────────────────────────────────

export const GET = withAuth(async (request: NextRequest, token: DecodedIdToken) => {
  try {
    const { searchParams } = new URL(request.url);
    const targetUserId = searchParams.get('userId');
    const startDateStr = searchParams.get('startDate');
    const endDateStr   = searchParams.get('endDate');
    // Viewer's IANA timezone — used to interpret calendar dates correctly.
    // Defaults to UTC so the API stays backward-compatible.
    const viewerTimezone = searchParams.get('timezone') || 'UTC';

    if (!startDateStr || !endDateStr) {
      return NextResponse.json({ error: 'startDate and endDate required' }, { status: 400 });
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDateStr) || !/^\d{4}-\d{2}-\d{2}$/.test(endDateStr)) {
      return NextResponse.json({ error: 'Invalid date format' }, { status: 400 });
    }

    const userId = targetUserId || token.uid;

    if (userId !== token.uid) {
      const caller = await getUserById(token.uid);
      if (!caller?.permittedPageIds?.includes('shift-management')) {
        return NextResponse.json({ error: 'Access denied' }, { status: 403 });
      }
    }

    // Interpret the date strings as calendar-day boundaries in the viewer's timezone,
    // so that e.g. "4 March" in GMT+2 correctly maps to UTC 2026-03-03T22:00 – 2026-03-04T21:59.
    const startDate = dateToDayStartUTC(startDateStr, viewerTimezone);
    const endDate   = dateToDayEndUTC(endDateStr,   viewerTimezone);

    const diffDays = (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24);
    if (diffDays > 32 || diffDays < 0) {
      return NextResponse.json({ error: 'Date range must be 0-31 days' }, { status: 400 });
    }

    const [newEntries, targetUser] = await Promise.all([
      getLedgerEntriesByDateRange(userId, startDate, endDate),
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
