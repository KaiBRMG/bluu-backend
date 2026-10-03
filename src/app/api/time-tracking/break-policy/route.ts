import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { getShiftBreakPolicy } from '@/lib/services/timeTrackingSettingsService';
import { getShiftsByUserAndRange } from '@/lib/services/shiftService';
import { expandShiftsForWindow } from '@/lib/utils/recurrence';
import { serialiseShift } from '@/lib/utils/shiftSerialise';
import { computeBreakBlockWindows } from '@/lib/shiftBreakPolicy';
import type { DecodedIdToken } from 'firebase-admin/auth';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * GET /api/time-tracking/break-policy
 *
 * The caller's no-break windows (first / last hour of each scheduled shift
 * occurrence) for roughly the next day. Empty when the org policy is off, or
 * when the caller has no shift — someone who tracks time freely is never
 * restricted. Leave-approved occurrences are tombstoned, so they drop out of
 * the expansion like they do everywhere else.
 *
 * Cost: 1 doc read when the policy is off; otherwise the same user-scoped
 * shift queries as `GET /api/shifts`. The renderer fetches this at clock-in
 * and every 15 min while a session runs — never on the Break press itself.
 *
 * Not cached: per-user, and an admin editing the roster or the policy should
 * reach the next fetch, which is already infrequent.
 */
export const GET = withAuth(async (_request: NextRequest, token: DecodedIdToken) => {
  try {
    const policy = await getShiftBreakPolicy();
    if (!policy.restrictBreaksAtShiftEdges) {
      return NextResponse.json({ restricted: false, windows: [] }, { headers: { 'Cache-Control': 'no-store' } });
    }

    const now = Date.now();
    // The range query is on `startTime`, so look back far enough to catch a
    // one-off shift that started yesterday and is still running.
    const docs = await getShiftsByUserAndRange(token.uid, now - 2 * DAY_MS, now + DAY_MS);
    const occurrences = expandShiftsForWindow(
      docs.map(s => ({ ...serialiseShift(s), timeWorkedSeconds: null, attendanceStatus: null })),
      now - DAY_MS,
      now + DAY_MS,
    );
    const windows = computeBreakBlockWindows(
      occurrences.map(o => ({ start: o.occurrenceStart, end: o.occurrenceEnd })),
    ).filter(w => w.end > now);

    return NextResponse.json({ restricted: true, windows }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('[break-policy GET]', err);
    return NextResponse.json({ error: 'Failed to load break policy' }, { status: 500 });
  }
});
