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
 *
 * `&detail=claimants` (admin only, Coverage → To assign) adds a `load` to each
 * open claim: the claimant's shifts and accounts on that day, and what assigning
 * this offer would put them on. Opt-in because it costs one
 * roster read per claimant, and the agent calendar — which admins also open —
 * renders none of it (rule 9i).
 *
 * **Finalised months are excluded.** An offer whose window has ended stays on
 * the board until payroll closes on its month, then it is dropped from the
 * response — it can no longer be claimed, assigned or unassigned, so it is not
 * a decision for anyone. The floor depends on who is reading:
 *
 * - **Coverage → To assign** (`detail=claimants`, admin): the first day of the
 *   roster-wide payroll month (`resolvePayrollMonth`) — last month while any
 *   agent still has it open, otherwise this month.
 * - **Everyone else** (the agent calendar): the caller's own floor
 *   (`lateCoverFloorDay`) — last month until *they* are finalised for it.
 *
 * Upcoming offers are never filtered. The floor is only read when the requested
 * range reaches into the past. The claim and assign routes still make the exact
 * per-agent check (`lateCoverRefusal`), because the admin floor is roster-wide.
 *
 * Admins also get `withdrawals` — absences that were cancelled after approval.
 * Those offers are *deleted* rather than left as history (the occurrence has to
 * be re-releasable), so without this an admin who saw four accounts on the board
 * yesterday would find them simply gone with no account of why.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { handleApiError, checkPageAccess } from '@/lib/middleware/apiHelpers';
import { getOffers, getClaimantLoads, lateCoverFloorDay } from '@/lib/services/caCoverageService';
import { resolvePayrollMonth } from '@/lib/services/caSalaryService';
import { getRecentLeaveWithdrawals } from '@/lib/services/coverageNotices';
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
    const withClaimantDetail = searchParams.get('detail') === 'claimants';

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
    const today = currentDayKey();
    const [fetched, floor] = await Promise.all([
      getOffers({
        fromDay: from,
        toDay: to,
        status: (status as 'available' | 'assigned' | 'cancelled' | null) ?? undefined,
      }),
      // Only a range reaching into the past can contain a finalised month.
      from >= today
        ? Promise.resolve(today)
        : isAdmin && withClaimantDetail
          ? resolvePayrollMonth().then(month => `${month}-01`)
          : lateCoverFloorDay(token.uid),
    ]);

    // Drop ended offers from finalised months before anything else is read for
    // them — names and claimant loads cost reads (rule 9) and wire (rule 9i).
    const now = Date.now();
    const offers = fetched.filter(o => o.windowEnd > now || o.day >= floor);

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

    const loads = isAdmin && withClaimantDetail ? await getClaimantLoads(offers) : null;

    const rows = offers.map(offer => ({
      ...offer,
      originalUserName: names.get(offer.originalUserId) ?? null,
      assignedToName: offer.assignedTo ? (names.get(offer.assignedTo) ?? null) : null,
      claimCount: offer.claims.length,
      myClaim: offer.claims.find(c => c.userId === token.uid) ?? null,
      // Who else claimed is an admin's decision input, not public information.
      claims: isAdmin
        ? offer.claims.map(c => ({
            ...c,
            displayName: names.get(c.userId) ?? c.userId,
            load: loads?.get(`${offer.offerId}:${c.userId}`) ?? null,
          }))
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
      // Admin-only: it names the absent agent and everyone whose overtime was
      // taken back, which is roster information rather than board information.
      withdrawals: isAdmin ? await getRecentLeaveWithdrawals(10) : [],
      timezone: safeTimezone(caller?.timezone),
    });
  } catch (err) {
    return handleApiError(err, 'ca-coverage/offers GET');
  }
});
