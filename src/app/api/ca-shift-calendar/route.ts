import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { getUserById } from '@/lib/services/userService';
import { loadShiftRoster } from '@/lib/services/shiftRosterService';
import type { DecodedIdToken } from 'firebase-admin/auth';

/**
 * GET /api/ca-shift-calendar?weekStart=YYYY-MM-DD
 *
 * The shift roster for CA Portal → Shift Calendar, which draws the same shifts
 * as Shift Management → Schedule with **creators** as rows. Built by the same
 * `loadShiftRoster`, so the two grids cannot disagree.
 *
 * ## Two readers, two projections
 *
 * - **`ca-shift-calendar` holders (agents)** get only what the grid draws: each
 *   occurrence's agent, window and accounts, and each agent's name and photo.
 *   No attendance, time worked, leave or recurrence detail — those are about a
 *   colleague's conduct and stay with admins.
 * - **`shift-management` holders (admins)** get the full occurrence (the edit
 *   dialog needs recurrence and wall-clock fields), attendance and leave, and
 *   every eligible agent for the assignment picker. `canEdit` tells the page to
 *   render the edit affordances; the write routes (`/api/shifts`) enforce the
 *   same permission themselves, so the flag is a UI hint, never the gate.
 *
 * ## Window
 *
 * The page groups by the viewer's local day, so a day at either end of the week
 * can begin or end up to 14h outside the UTC week. The query is padded by a day
 * on each side; otherwise an overnight shift that started before the window
 * would vanish and its hours would read as a coverage gap that does not exist.
 *
 * ## Caching (rule 9i)
 *
 * Per-user, so only the browser may cache it: `private, max-age=60` +
 * `Vary: Authorization` for readers. Editors get `no-store` — they refetch
 * straight after a write and must see it.
 */

const DAY_MS = 86_400_000;

export const GET = withAuth(async (request: NextRequest, token: DecodedIdToken) => {
  try {
    const caller = await getUserById(token.uid);
    const pages: string[] = caller?.permittedPageIds ?? [];
    const canEdit = pages.includes('shift-management');
    if (!canEdit && !pages.includes('ca-shift-calendar')) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const weekStart = new URL(request.url).searchParams.get('weekStart') ?? '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
      return NextResponse.json({ error: 'weekStart required (YYYY-MM-DD)' }, { status: 400 });
    }
    const [wy, wm, wd] = weekStart.split('-').map(Number);
    const weekStartMs = Date.UTC(wy, wm - 1, wd);
    if (Number.isNaN(weekStartMs)) {
      return NextResponse.json({ error: 'Invalid weekStart' }, { status: 400 });
    }

    const { shifts, users } = await loadShiftRoster({
      windowStartMs: weekStartMs - DAY_MS,
      windowEndMs: weekStartMs + 8 * DAY_MS - 1,
      includeDetail: canEdit,
      includeAllUsers: canEdit,
    });

    if (canEdit) {
      return NextResponse.json(
        { canEdit: true, shifts, users },
        { headers: { 'Cache-Control': 'private, no-store' } },
      );
    }

    // Reader projection — only what the grid renders.
    const projected = shifts
      .filter(s => (s.creatorIds?.length ?? 0) > 0)
      .map(s => ({
        shiftId: s.shiftId,
        userId: s.userId,
        occurrenceStart: s.occurrenceStart,
        occurrenceEnd: s.occurrenceEnd,
        creatorIds: s.creatorIds ?? [],
        overtimeCreatorIds: s.overtimeCreatorIds ?? [],
        isOvertime: s.isOvertime ?? false,
        paysWage: s.paysWage,
      }));
    const onShift = new Set(projected.map(s => s.userId));
    const people = users
      .filter(u => onShift.has(u.uid))
      .map(u => ({ uid: u.uid, displayName: u.displayName, photoURL: u.photoURL }));

    return NextResponse.json(
      { canEdit: false, shifts: projected, users: people },
      { headers: { 'Cache-Control': 'private, max-age=60', Vary: 'Authorization' } },
    );
  } catch (err) {
    console.error('[ca-shift-calendar GET]', err);
    return NextResponse.json({ error: 'Failed to load the shift calendar' }, { status: 500 });
  }
});
