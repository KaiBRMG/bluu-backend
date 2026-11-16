import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { getUserById } from '@/lib/services/userService';
import { loadShiftRoster } from '@/lib/services/shiftRosterService';
import type { DecodedIdToken } from 'firebase-admin/auth';

// ─── GET /api/shifts/week ─────────────────────────────────────────────
// ?weekStart=YYYY-MM-DD  (Monday of the week, UTC)
// &userId=uid            (optional — restrict to one user)
//
// The roster itself is built by `loadShiftRoster`, which the CA Portal's Shift
// Calendar (`/api/ca-shift-calendar`) shares, so the two grids cannot disagree.
// Not browser-cached: it is the admin's editing surface and is refetched right
// after every write.

export const GET = withAuth(async (request: NextRequest, token: DecodedIdToken) => {
  try {
    const caller = await getUserById(token.uid);
    if (!caller?.permittedPageIds?.includes('shift-management')) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const weekStartStr = searchParams.get('weekStart');
    const filterUserId = searchParams.get('userId') ?? null;

    if (!weekStartStr) {
      return NextResponse.json({ error: 'weekStart required (YYYY-MM-DD)' }, { status: 400 });
    }

    // Compute week window: Mon 00:00 UTC → Sun 23:59:59.999 UTC
    const [wy, wm, wd] = weekStartStr.split('-').map(Number);
    const weekStartMs  = Date.UTC(wy, wm - 1, wd, 0, 0, 0, 0);
    const weekEndMs    = Date.UTC(wy, wm - 1, wd + 6, 23, 59, 59, 999);

    if (isNaN(weekStartMs)) {
      return NextResponse.json({ error: 'Invalid weekStart format' }, { status: 400 });
    }

    const { shifts, users } = await loadShiftRoster({
      windowStartMs: weekStartMs,
      windowEndMs: weekEndMs,
      filterUserId,
      includeDetail: true,
      includeAllUsers: true,
    });

    return NextResponse.json({ shifts, users });
  } catch (err) {
    console.error('[shifts/week GET]', err);
    return NextResponse.json({ error: 'Failed to fetch week shifts' }, { status: 500 });
  }
});
