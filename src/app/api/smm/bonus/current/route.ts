import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import {
  SMM_SUBMISSIONS_SUB,
  checkSmmAccess,
  getCurrentRoundSnap,
  resolveUserInfo,
  serializeRound,
  serializeSubmission,
} from '@/lib/services/smmService';
import type { DecodedIdToken } from 'firebase-admin/auth';

/**
 * GET /api/smm/bonus/current?scope=me|all
 *  - me  (dashboard): the current round + the caller's own submissions + their total
 *  - all (admin):     the current round + all submissions + the full userTotals table
 */
export const GET = withAuth(async (request: NextRequest, token: DecodedIdToken) => {
  try {
    const scope = request.nextUrl.searchParams.get('scope') ?? 'me';

    const denied = await checkSmmAccess(token.uid, scope === 'all' ? 'admin' : 'dashboard');
    if (denied) return denied;

    const roundSnap = await getCurrentRoundSnap();
    if (!roundSnap) {
      return NextResponse.json({ round: null, submissions: [], myTotal: 0, userTotals: [] });
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
      return NextResponse.json({ round, submissions, userTotals: totals });
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
