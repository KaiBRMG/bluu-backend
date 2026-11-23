import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { getShiftsByUserAndRange } from '@/lib/services/shiftService';
import { expandShiftsForWindow } from '@/lib/utils/recurrence';
import { serialiseShift } from '@/lib/utils/shiftSerialise';
import { mergeShiftSpans } from '@/lib/shiftSpans';
import type { DecodedIdToken } from 'firebase-admin/auth';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * GET /api/time-tracking/my-shift
 *
 * The caller's OWN scheduled shift spans around now (±1 day), merged so that
 * back-to-back occurrences (a regular shift followed by cover) read as one
 * shift — the same merge the break policy applies (`computeBreakBlockWindows`).
 * The time-tracking page picks today's span from these and draws it as the
 * dashed arc around the clock.
 *
 * Self-scoped by construction: the uid comes from the verified token and there
 * is no `userId` parameter, so nobody can read another person's roster here
 * (`GET /api/shifts/week` is the admin surface for that). Leave-approved
 * occurrences are tombstoned and drop out of the expansion as everywhere else.
 *
 * Cost: the same user-scoped shift queries as the break policy; no user doc
 * read. Unlike the break policy it runs regardless of the org setting — a shift
 * is worth showing whether or not breaks are restricted around it.
 *
 * Cache: per-user, so browser-only (`private` would make `s-maxage` inert —
 * rule 9i). Five minutes is short enough that a roster edit reaches the page
 * within one sitting, and the page only fetches on mount.
 */
export const GET = withAuth(async (_request: NextRequest, token: DecodedIdToken) => {
  try {
    const now = Date.now();
    // The range query is on `startTime`, so look back far enough to catch a
    // one-off shift that started yesterday and is still running.
    const docs = await getShiftsByUserAndRange(token.uid, now - 2 * DAY_MS, now + DAY_MS);
    const occurrences = expandShiftsForWindow(
      docs.map(s => ({ ...serialiseShift(s), timeWorkedSeconds: null, attendanceStatus: null })),
      now - DAY_MS,
      now + DAY_MS,
    );
    const shifts = mergeShiftSpans(
      occurrences.map(o => ({ start: o.occurrenceStart, end: o.occurrenceEnd })),
    );

    return NextResponse.json(
      { shifts },
      { headers: { 'Cache-Control': 'private, max-age=300', Vary: 'Authorization' } },
    );
  } catch (err) {
    console.error('[my-shift GET]', err);
    return NextResponse.json({ error: 'Failed to load your shift' }, { status: 500 });
  }
});
