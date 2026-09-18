import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { adminDb } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { checkPageAccess } from '@/lib/middleware/apiHelpers';
import { queueDisputeNotice } from '@/lib/services/disputeNotices';
import type { DecodedIdToken } from 'firebase-admin/auth';
import type { ApprovalStatus } from '@/types/firestore';

/**
 * PATCH /api/disputes/bulk-approval
 *
 * Sets `AdminApproval` on many disputes at once. Caller must have the
 * `ca-admin` page permission — the same tier as the single-dispute route, since
 * this is that route's decision taken N times and nothing more.
 *
 * Body: `{ disputeIds: string[], AdminApproval: 'Approved' | 'Rejected', reason?: string }`
 *
 * **Why a route instead of N client calls.** A team leader rules the same way on
 * a whole screen of disputes; firing ten `PATCH`es for that is ten round trips,
 * ten reads and ten notification writes for one decision. Here it is one
 * `getAll`, one batched write, and **one queued notice per filer** — a person
 * with six of the ten disputes is told once, about six.
 *
 * Partial success is reported, not thrown: an id that has vanished since the
 * page was loaded is counted in `skipped` while the rest are still written. The
 * alternative — failing the whole set — would make a stale row block a
 * reviewer's entire screen.
 */

/**
 * Ceiling on one call. The admin table pages at 10, so this is already far
 * beyond any real selection; it exists so a malformed or hostile body cannot
 * turn one request into an unbounded read. Also keeps the write inside the
 * 500-operation limit of a single Firestore batch.
 */
const MAX_BULK = 100;

export const PATCH = withAuth(async (request: NextRequest, token: DecodedIdToken) => {
  try {
    const denied = await checkPageAccess(token.uid, 'ca-admin');
    if (denied) return denied;

    const body = await request.json();
    const { disputeIds, AdminApproval, reason } = body as {
      disputeIds: unknown;
      AdminApproval: ApprovalStatus;
      reason?: string;
    };

    if (AdminApproval !== 'Approved' && AdminApproval !== 'Rejected') {
      return NextResponse.json({ error: 'AdminApproval must be Approved or Rejected' }, { status: 400 });
    }

    if (!Array.isArray(disputeIds)) {
      return NextResponse.json({ error: 'disputeIds must be an array' }, { status: 400 });
    }

    const ids = [...new Set(disputeIds.filter((id): id is string => typeof id === 'string' && id.length > 0))];
    if (ids.length === 0) {
      return NextResponse.json({ error: 'disputeIds must contain at least one id' }, { status: 400 });
    }
    if (ids.length > MAX_BULK) {
      return NextResponse.json({ error: `Cannot process more than ${MAX_BULK} disputes at once` }, { status: 400 });
    }

    const col = adminDb.collection('disputes');
    // One round trip for the whole set rather than a read per id (rule 9).
    const snaps = await adminDb.getAll(...ids.map(id => col.doc(id)));

    const batch = adminDb.batch();
    // How many disputes each filer is being told about, so the notice is queued
    // once per person rather than once per dispute.
    const countByFiler = new Map<string, number>();
    let updated = 0;

    for (const snap of snaps) {
      if (!snap.exists) continue;
      const dispute = snap.data()!;

      batch.update(snap.ref, { AdminApproval, resolvedAt: FieldValue.serverTimestamp() });
      updated += 1;

      if (typeof dispute.createdBy === 'string' && dispute.createdBy) {
        countByFiler.set(dispute.createdBy, (countByFiler.get(dispute.createdBy) ?? 0) + 1);
      }
    }

    if (updated === 0) {
      return NextResponse.json({ error: 'None of those disputes exist' }, { status: 404 });
    }

    await batch.commit();

    // Queued after the commit, never before: the notice must describe work that
    // is actually written. `queueDisputeNotice` never throws, so a queue failure
    // cannot undo a decision the reviewer can already see.
    await Promise.all(
      [...countByFiler].map(([userId, count]) =>
        queueDisputeNotice({
          stage: 'admin',
          outcome: AdminApproval === 'Approved' ? 'approved' : 'rejected',
          userId,
          reason,
          count,
        }),
      ),
    );

    return NextResponse.json({ success: true, updated, skipped: ids.length - updated });
  } catch (error) {
    console.error('[disputes bulk-approval PATCH]', error);
    return NextResponse.json({ error: 'Failed to update disputes' }, { status: 500 });
  }
});
