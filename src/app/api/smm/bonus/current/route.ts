import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { adminDb } from '@/lib/firebase-admin';
import {
  SMM_BONUS,
  SMM_SUBMISSIONS_SUB,
  checkSmmAccess,
  getCurrentRoundSnap,
  resolveUserInfo,
  serializeRound,
  serializeSubmission,
} from '@/lib/services/smmService';
import type { DecodedIdToken } from 'firebase-admin/auth';

/**
 * GET /api/smm/bonus/current?scope=me|all[&roundId=ID]
 *  - me  (dashboard): the current round + the caller's own submissions + their total
 *  - all (admin):     the current round + all submissions + the full userTotals table,
 *                     plus `rounds` — every round's id/window, for the Bonus
 *                     Management round picker.
 *
 * `roundId` views a specific round instead of the current one; the default is
 * the round whose window contains today (see getCurrentRoundSnap).
 */
export const GET = withAuth(async (request: NextRequest, token: DecodedIdToken) => {
  try {
    const scope = request.nextUrl.searchParams.get('scope') ?? 'me';
    const roundId = request.nextUrl.searchParams.get('roundId');

    const denied = await checkSmmAccess(token.uid, scope === 'all' ? 'admin' : 'dashboard');
    if (denied) return denied;

    // The picker only exists on the admin surface, so only that scope pays for
    // the rounds listing (a handful of small docs).
    const roundsMeta = scope === 'all'
      ? (await adminDb.collection(SMM_BONUS).orderBy('roundDateStart', 'desc').get())
          .docs.map(serializeRound)
      : [];

    const roundSnap = roundId
      ? await adminDb.collection(SMM_BONUS).doc(roundId).get()
      : await getCurrentRoundSnap();

    if (!roundSnap?.exists) {
      return NextResponse.json({
        round: null, submissions: [], myTotal: 0, userTotals: [], rounds: roundsMeta,
      });
    }

    const round = serializeRound(roundSnap);
    const userTotals = (roundSnap.data()?.userTotals ?? {}) as Record<string, number>;
    const subsRef = roundSnap.ref.collection(SMM_SUBMISSIONS_SUB);

    if (scope === 'all') {
      const subsSnap = await subsRef.orderBy('submissionDate', 'desc').get();
      const submissions = subsSnap.docs.map(serializeSubmission);
      const names = await resolveUserInfo([
        ...submissions.map((s) => s.submittedBy),
        ...Object.keys(userTotals),
      ]);
      for (const s of submissions) {
        s.submittedByName = names.get(s.submittedBy)?.displayName ?? '';
        s.submittedByPhotoURL = names.get(s.submittedBy)?.photoURL ?? null;
      }
      const totals = Object.entries(userTotals).map(([uid, total]) => ({
        uid,
        displayName: names.get(uid)?.displayName ?? '',
        photoURL: names.get(uid)?.photoURL ?? null,
        total,
      })).sort((a, b) => b.total - a.total);
      return NextResponse.json({ round, submissions, userTotals: totals, rounds: roundsMeta });
    }

    // scope=me
    const subsSnap = await subsRef.where('submittedBy', '==', token.uid).get();
    const submissions = subsSnap.docs.map(serializeSubmission)
      .sort((a, b) => (b.submissionDate ?? '').localeCompare(a.submissionDate ?? ''));
    return NextResponse.json({ round, submissions, myTotal: userTotals[token.uid] ?? 0 });
  } catch (error) {
    console.error('[GET /api/smm/bonus/current]', error);
    return NextResponse.json({ error: 'Failed to fetch current round' }, { status: 500 });
  }
});
