/**
 * GET /api/ca-coverage/offers?from=YYYY-MM-DD&to=YYYY-MM-DD[&status=available]
 *
 * The Available Shifts board. Readable by any chat agent — overtime is
 * first-come, and a board only some people can see is not a fair one.
 *
 * Each row carries `myClaim` and `claimCount` so the agent-facing board can
 * render its own state without shipping every claimant's identity to everyone.
 * Full claim lists are admin-only: who else put their name down is the admin's
 * decision input, not a leaderboard.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { handleApiError, checkPageAccess } from '@/lib/middleware/apiHelpers';
import { getOffers } from '@/lib/services/caCoverageService';
import { isDayKey, currentDayKey, addDays } from '@/lib/salary/salaryDate';
import { getUserById } from '@/lib/services/userService';
import { adminDb } from '@/lib/firebase-admin';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { safeTimezone } from '@/lib/utils/timezone';

export const GET = withAuth(async (request: NextRequest, token: DecodedIdToken) => {
  try {
    const { searchParams } = new URL(request.url);
    const from = searchParams.get('from') ?? addDays(currentDayKey(), -1);
    const to = searchParams.get('to') ?? addDays(currentDayKey(), 45);
    const status = searchParams.get('status');

    if (!isDayKey(from) || !isDayKey(to)) {
      return NextResponse.json({ error: 'from and to must be YYYY-MM-DD' }, { status: 400 });
    }
    if (from > to) {
      return NextResponse.json({ error: 'from must not be after to' }, { status: 400 });
    }
    if (status !== null && !['available', 'assigned', 'cancelled'].includes(status)) {
      return NextResponse.json({ error: 'Unknown status filter' }, { status: 400 });
    }

    const isAdmin = (await checkPageAccess(token.uid, 'ca-admin')) === null;
    const offers = await getOffers({
      fromDay: from,
      toDay: to,
      status: (status as 'available' | 'assigned' | 'cancelled' | null) ?? undefined,
    });

    // Resolve the names an agent needs to make sense of a row: whose absence
    // created it, and who ended up covering. One batched read for the whole
    // board rather than one per offer (rule 9).
    const uids = [
      ...new Set(offers.flatMap(o => [o.originalUserId, o.assignedTo].filter(Boolean) as string[])),
    ];
    const names = new Map<string, string>();
    if (uids.length > 0) {
      const snaps = await adminDb.getAll(...uids.map(uid => adminDb.collection('users').doc(uid)));
      for (const snap of snaps) {
        if (snap.exists) names.set(snap.id, snap.data()?.displayName ?? snap.id);
      }
    }

    const rows = offers.map(offer => ({
      ...offer,
      originalUserName: names.get(offer.originalUserId) ?? null,
      assignedToName: offer.assignedTo ? (names.get(offer.assignedTo) ?? null) : null,
      claimCount: offer.claims.length,
      myClaim: offer.claims.find(c => c.userId === token.uid) ?? null,
      // Who else claimed is an admin's decision input, not public information.
      claims: isAdmin
        ? offer.claims.map(c => ({ ...c, displayName: names.get(c.userId) ?? c.userId }))
        : undefined,
    }));

    // Claimant names are only resolved above for admins; fill in the rest.
    if (isAdmin) {
      const claimUids = [...new Set(offers.flatMap(o => o.claims.map(c => c.userId)))].filter(
        uid => !names.has(uid),
      );
      if (claimUids.length > 0) {
        const snaps = await adminDb.getAll(...claimUids.map(uid => adminDb.collection('users').doc(uid)));
        for (const snap of snaps) if (snap.exists) names.set(snap.id, snap.data()?.displayName ?? snap.id);
        for (const row of rows) {
          if (row.claims) row.claims = row.claims.map(c => ({ ...c, displayName: names.get(c.userId) ?? c.userId }));
        }
      }
    }

    const caller = await getUserById(token.uid);

    return NextResponse.json({
      offers: rows,
      isAdmin,
      timezone: safeTimezone(caller?.timezone),
    });
  } catch (err) {
    return handleApiError(err, 'ca-coverage/offers GET');
  }
});
