import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { adminDb } from '@/lib/firebase-admin';
import { DocumentData } from 'firebase-admin/firestore';
import { byNewest, serialiseDisputes } from '@/lib/services/disputeSerialise';
import { disputeStage } from '@/components/disputes/disputeStatus';
import type { DecodedIdToken } from 'firebase-admin/auth';
import type { DisputeDocument } from '@/types/firestore';

/**
 * GET /api/disputes/summary — everything the dashboard's Sale Disputes column
 * needs, in one request.
 *
 * ## Why this exists rather than three calls to `/api/disputes`
 *
 * The column answers three questions at once: what is waiting on *me*, where
 * did *my* claims get to, and what was decided while I was away. Assembled from
 * the paginated list that would be three HTTP requests and three Firestore
 * queries — and one of them (`created-resolved`) already scans every dispute
 * the caller ever filed, so the "open" query is a strict subset of it being run
 * twice. Here it is **one request and two queries**, with one batched name
 * resolution across the whole payload (CLAUDE.md rule 9).
 *
 * ## No new index, on purpose
 *
 * Neither query orders or ranges, so both are served by Firestore's equality
 * merge-join on single-field indexes — the same reason `/api/disputes` declares
 * no composite index for `disputes` either. Adding `orderBy('createdAt')` to
 * cap the filed-by-me scan would buy a `limit()` at the price of a composite
 * index and a deploy; sorting in memory keeps this deployable with the code.
 * The scan is bounded in practice by how many disputes one agent has ever
 * filed (tens), and the same scan already runs today on the Resolved tab.
 *
 * ## Authorization
 *
 * Both queries are keyed to the caller's own uid, so the route needs no page
 * permission — exactly like the agent-facing filters on `/api/disputes`. It
 * must never grow a parameter that lets a caller name someone else's uid.
 */

/** Rows shown inline in the column before it defers to "All disputes". */
const REVIEW_LIMIT = 4;
const MINE_LIMIT = 3;

/** How long a decided dispute keeps announcing itself on the dashboard. */
const DECISION_WINDOW_DAYS = 14;

export interface DisputeSummaryPayload {
  /** Disputes assigned to the caller that they have not ruled on yet. */
  review: { total: number; disputes: DisputeDocument[] };
  /** Disputes the caller filed that have not reached a final verdict. */
  mine: {
    total: number;
    awaitingCa: number;
    awaitingAdmin: number;
    disputes: DisputeDocument[];
  };
  /**
   * The caller's own disputes decided inside the window — the answer they were
   * never reliably given, since the decision notification is coalesced and
   * lands in a tray they may not open.
   */
  decided: DisputeDocument[];
}

export const GET = withAuth(async (_request: NextRequest, token: DecodedIdToken) => {
  try {
    const uid = token.uid;
    const col = adminDb.collection('disputes');

    const [assignedSnap, mineSnap] = await Promise.all([
      col
        .where('assignedTo', '==', uid)
        .where('CaApproval', '==', 'Pending')
        .where('AdminApproval', '==', 'Pending')
        .get(),
      col.where('createdBy', '==', uid).get(),
    ]);

    type RawDispute = DocumentData & { _id: string };

    const assigned: RawDispute[] = assignedSnap.docs
      .map(d => ({ _id: d.id, ...d.data() }))
      .sort(byNewest);

    const mineAll: RawDispute[] = mineSnap.docs
      .map(d => ({ _id: d.id, ...d.data() }))
      .sort(byNewest);

    const cutoff = Date.now() - DECISION_WINDOW_DAYS * 86_400_000;

    // A dispute is "mine and open" until an admin rules, with one exception:
    // a CA rejection is terminal for the filer, who has to refile rather than
    // wait. Treating `declined-ca` as open would park a dead claim in the
    // "waiting on" list forever.
    const mineOpen = mineAll.filter(
      d => d.AdminApproval === 'Pending' && d.CaApproval !== 'Rejected',
    );

    // Decided *recently*. `resolvedAt` is absent on every dispute settled
    // before the field existed, and an absent stamp reads as "not recent"
    // rather than as the epoch — see `serialiseDispute`.
    const decided = mineAll.filter(d => {
      const ms = d.resolvedAt?.toMillis?.();
      return typeof ms === 'number' && ms >= cutoff;
    });

    const reviewShown = assigned.slice(0, REVIEW_LIMIT);
    const mineShown = mineOpen.slice(0, MINE_LIMIT);

    // One name resolution for the whole payload, then split back out — three
    // separate calls would re-fetch the same creators and the same people.
    const serialised = await serialiseDisputes([...reviewShown, ...mineShown, ...decided]);
    const byId = new Map(serialised.map(d => [d.id, d]));
    const take = (docs: { _id: string }[]) =>
      docs.map(d => byId.get(d._id)).filter((d): d is DisputeDocument => Boolean(d));

    let awaitingCa = 0;
    let awaitingAdmin = 0;
    for (const d of mineOpen) {
      const stage = disputeStage({
        CaApproval: d.CaApproval,
        AdminApproval: d.AdminApproval,
        assignedTo: d.assignedTo,
      });
      if (stage === 'awaiting-ca') awaitingCa += 1;
      else if (stage === 'awaiting-admin') awaitingAdmin += 1;
    }

    const payload: DisputeSummaryPayload = {
      review: { total: assigned.length, disputes: take(reviewShown) },
      mine: {
        total: mineOpen.length,
        awaitingCa,
        awaitingAdmin,
        disputes: take(mineShown),
      },
      decided: take(decided),
    };

    return NextResponse.json(payload);
  } catch (error) {
    console.error('[disputes summary GET]', error);
    return NextResponse.json({ error: 'Failed to load dispute summary' }, { status: 500 });
  }
});
