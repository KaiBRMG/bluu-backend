import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { adminDb } from '@/lib/firebase-admin';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import {
  SMM_BONUS,
  SMM_SUBMISSIONS_SUB,
  checkSmmAccess,
  resolveUserInfo,
  serializeRound,
  serializeSubmission,
} from '@/lib/services/smmService';
import type { DecodedIdToken } from 'firebase-admin/auth';

const ROUNDS_PAGE_SIZE = 3;

/**
 * GET /api/smm/bonus/rounds?scope=me|all&page=N
 * Previous rounds, paginated by round. Iterates round docs (few) and runs a
 * per-round submission query — avoids a submittedBy collection-group index.
 */
export const GET = withAuth(async (request: NextRequest, token: DecodedIdToken) => {
  try {
    const scope = request.nextUrl.searchParams.get('scope') ?? 'me';
    const page = Math.max(1, parseInt(request.nextUrl.searchParams.get('page') ?? '1', 10) || 1);

    const denied = await checkSmmAccess(token.uid, scope === 'all' ? 'admin' : 'dashboard');
    if (denied) return denied;

    const roundsSnap = await adminDb.collection(SMM_BONUS).orderBy('roundDateStart', 'desc').get();
    const totalPages = Math.max(1, Math.ceil(roundsSnap.docs.length / ROUNDS_PAGE_SIZE));
    const pageDocs = roundsSnap.docs.slice((page - 1) * ROUNDS_PAGE_SIZE, page * ROUNDS_PAGE_SIZE);

    // Run every round's submission query in parallel, then resolve all user
    // names across the page in a single getAll (a heavy submitter recurring in
    // multiple rounds is read once, not once per round).
    const perRound = await Promise.all(pageDocs.map(async (roundDoc) => {
      const userTotals = (roundDoc.data()?.userTotals ?? {}) as Record<string, number>;
      let query = roundDoc.ref.collection(SMM_SUBMISSIONS_SUB) as FirebaseFirestore.Query;
      if (scope === 'me') query = query.where('submittedBy', '==', token.uid);
      const subsSnap = await query.get();
      const submissions = subsSnap.docs.map(serializeSubmission)
        .sort((a, b) => (b.submissionDate ?? '').localeCompare(a.submissionDate ?? ''));
      return { roundDoc, userTotals, submissions };
    }));

    const names = await resolveUserInfo(
      perRound.flatMap((r) => [...r.submissions.map((s) => s.submittedBy), ...Object.keys(r.userTotals)]),
    );

    const rounds = perRound.map(({ roundDoc, userTotals, submissions }) => {
      for (const s of submissions) {
        s.submittedByName = names.get(s.submittedBy)?.displayName ?? '';
        s.submittedByPhotoURL = names.get(s.submittedBy)?.photoURL ?? null;
      }

      // Dashboard sees only its own payout; admin sees the whole table.
      const totals = scope === 'me'
        ? [{ uid: token.uid, displayName: names.get(token.uid)?.displayName ?? '', total: userTotals[token.uid] ?? 0 }]
        : Object.entries(userTotals).map(([uid, total]) => ({
            uid,
            displayName: names.get(uid)?.displayName ?? '',
            total,
          }));

      return { round: serializeRound(roundDoc), submissions, userTotals: totals };
    });

    return NextResponse.json({ rounds, page, totalPages });
  } catch (error) {
    console.error('[GET /api/smm/bonus/rounds]', error);
    return NextResponse.json({ error: 'Failed to fetch rounds' }, { status: 500 });
  }
});

/**
 * POST /api/smm/bonus/rounds — start a new round (admin page only). The
 * new round becomes "current" by virtue of the latest roundDateStart.
 */
export const POST = withAuth(async (request: NextRequest, token: DecodedIdToken) => {
  try {
    const denied = await checkSmmAccess(token.uid, 'admin');
    if (denied) return denied;

    const body = await request.json() as { roundDateStart?: string; roundDateEnd?: string };
    const start = new Date(body.roundDateStart ?? '');
    const end = new Date(body.roundDateEnd ?? '');
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return NextResponse.json({ error: 'Invalid round dates' }, { status: 400 });
    }
    if (start >= end) {
      return NextResponse.json({ error: 'Round start must be before end' }, { status: 400 });
    }

    const ref = adminDb.collection(SMM_BONUS).doc();
    await ref.set({
      roundDateStart: Timestamp.fromDate(start),
      roundDateEnd: Timestamp.fromDate(end),
      userTotals: {},
      createdTime: FieldValue.serverTimestamp(),
      createdBy: token.uid,
    });

    return NextResponse.json({ success: true, id: ref.id });
  } catch (error) {
    console.error('[POST /api/smm/bonus/rounds]', error);
    return NextResponse.json({ error: 'Failed to start round' }, { status: 500 });
  }
});
