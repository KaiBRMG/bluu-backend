import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { adminDb } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { SMM_BONUS, SMM_SUBMISSIONS_SUB, bonusTotalDelta, checkSmmAccess } from '@/lib/services/smmService';
import type { DecodedIdToken } from 'firebase-admin/auth';

/**
 * PATCH /api/smm/bonus/rounds/[roundId]/submissions/[submissionId]
 * Admin edit of a submission. userTotals is credited on approval only, so we
 * apply the delta transactionally:
 *   delta = (newApproved ? newAmount : 0) − (oldApproved ? oldAmount : 0)
 * This covers approve (+amount), reject/un-approve (−amount), and bonusAmount
 * edits while approved (±diff). Edits to a pending/rejected submission that
 * don't approve it leave userTotals untouched.
 */
export const PATCH = withAuth(async (
  request: NextRequest,
  token: DecodedIdToken,
  params: Promise<{ roundId: string; submissionId: string }>,
) => {
  try {
    const denied = await checkSmmAccess(token.uid, 'admin');
    if (denied) return denied;

    const { roundId, submissionId } = await params;
    const body = await request.json() as Record<string, unknown>;

    const roundRef = adminDb.collection(SMM_BONUS).doc(roundId);
    const subRef = roundRef.collection(SMM_SUBMISSIONS_SUB).doc(submissionId);

    const allowed = ['numLikes', 'status', 'bonusAmount', 'sysComments', 'adminApproval'];
    if (body.adminApproval !== undefined
      && !['pending', 'approved', 'rejected'].includes(body.adminApproval as string)) {
      return NextResponse.json({ error: 'Invalid approval value' }, { status: 400 });
    }
    if (body.bonusAmount !== undefined
      && (typeof body.bonusAmount !== 'number' || Number.isNaN(body.bonusAmount))) {
      return NextResponse.json({ error: 'Invalid bonus amount' }, { status: 400 });
    }

    await adminDb.runTransaction(async (tx) => {
      const subSnap = await tx.get(subRef);
      if (!subSnap.exists) throw new NotFound();
      const cur = subSnap.data()!;

      const updates: Record<string, unknown> = {};
      for (const key of allowed) {
        if (key in body) updates[key] = body[key];
      }

      const oldApproved = cur.adminApproval === 'approved';
      const oldAmount = (cur.bonusAmount as number) ?? 0;
      const delta = bonusTotalDelta({
        oldApproved,
        oldAmount,
        newApproved: 'adminApproval' in updates ? updates.adminApproval === 'approved' : oldApproved,
        newAmount: 'bonusAmount' in updates ? (updates.bonusAmount as number) : oldAmount,
      });

      tx.update(subRef, updates);
      if (delta !== 0 && cur.submittedBy) {
        tx.update(roundRef, { [`userTotals.${cur.submittedBy}`]: FieldValue.increment(delta) });
      }
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof NotFound) {
      return NextResponse.json({ error: 'Submission not found' }, { status: 404 });
    }
    console.error('[PATCH /api/smm/bonus/.../submissions/:id]', error);
    return NextResponse.json({ error: 'Failed to update submission' }, { status: 500 });
  }
});

/**
 * DELETE — remove a submission; if it was approved, subtract its bonus from
 * the submitter's total to keep the invariant.
 */
export const DELETE = withAuth(async (
  _request: NextRequest,
  token: DecodedIdToken,
  params: Promise<{ roundId: string; submissionId: string }>,
) => {
  try {
    const denied = await checkSmmAccess(token.uid, 'admin');
    if (denied) return denied;

    const { roundId, submissionId } = await params;
    const roundRef = adminDb.collection(SMM_BONUS).doc(roundId);
    const subRef = roundRef.collection(SMM_SUBMISSIONS_SUB).doc(submissionId);

    await adminDb.runTransaction(async (tx) => {
      const subSnap = await tx.get(subRef);
      if (!subSnap.exists) throw new NotFound();
      const cur = subSnap.data()!;
      tx.delete(subRef);
      // Deleting = new state is not-approved, $0.
      const delta = bonusTotalDelta({
        oldApproved: cur.adminApproval === 'approved',
        oldAmount: (cur.bonusAmount as number) ?? 0,
        newApproved: false,
        newAmount: 0,
      });
      if (delta !== 0 && cur.submittedBy) {
        tx.update(roundRef, { [`userTotals.${cur.submittedBy}`]: FieldValue.increment(delta) });
      }
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof NotFound) {
      return NextResponse.json({ error: 'Submission not found' }, { status: 404 });
    }
    console.error('[DELETE /api/smm/bonus/.../submissions/:id]', error);
    return NextResponse.json({ error: 'Failed to delete submission' }, { status: 500 });
  }
});

/** Sentinel to turn a not-found inside a transaction into a 404. */
class NotFound extends Error {}
