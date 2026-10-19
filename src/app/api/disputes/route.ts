import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { adminDb } from '@/lib/firebase-admin';
import { DocumentData, Timestamp } from 'firebase-admin/firestore';
import { byNewest, serialiseDisputes } from '@/lib/services/disputeSerialise';
import { checkPageAccess, readJsonBody } from '@/lib/middleware/apiHelpers';
import { fileDisputes } from '@/lib/services/disputeTransfer';
import { CLAIM_REFUSAL_LABEL, MAX_DISPUTE_SALES, NO_ONE } from '@/lib/disputes/disputeRules';
import type { DecodedIdToken } from 'firebase-admin/auth';

const PAGE_SIZE = 10;
const MAX_COMMENT = 2000;

/** How far back CA Admin → Sales' "Moved by dispute" feed looks. */
const MOVED_WINDOW_DAYS = 14;
const MOVED_DEFAULT_LIMIT = 8;
const MOVED_MAX_LIMIT = 50;

// ─── Helpers ─────────────────────────────────────────────────────────

function sortAndPaginate(docs: DocumentData[], page: number) {
  docs.sort(byNewest);
  const total = docs.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const paginated = docs.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  return { paginated, total, totalPages };
}

// ─── GET /api/disputes ────────────────────────────────────────────────
// Query params:
//   filter: assigned-pending | assigned-resolved | created-unresolved |
//           created-resolved — the agent's own views, paged by `page`
//         | admin-moved  — CA Admin → Sales' feed: disputes approved in the
//           last 14 days, newest approval first, `limit` (≤ 50) rows plus the
//           window's `total`. Ordered on `approvedAt`, a single-field index —
//           no composite needed. Disputes approved before the field existed
//           appear once `scripts/backfill-dispute-approved-at.js` has run.
//         | admin-ruling — open disputes only an admin can decide: claims on
//           a sale nobody holds (`No One`). Equality-only, so Firestore merges
//           single-field indexes — no composite, and the read is bounded by
//           what is actually waiting, not by every dispute ever declined.
//
// Uncached (rule 9i): a verdict changes every one of these, and the readers
// refetch after their own writes.

export const GET = withAuth(async (request: NextRequest, token: DecodedIdToken) => {
  try {
    const { searchParams } = new URL(request.url);
    const filter = searchParams.get('filter') ?? 'created-unresolved';
    const page = Math.max(1, parseInt(searchParams.get('page') ?? '1'));

    const uid = token.uid;
    const col = adminDb.collection('disputes');
    let rawDocs: DocumentData[] = [];

    if (filter === 'assigned-pending') {
      // Composite index: assignedTo ASC, CaApproval ASC, AdminApproval ASC, createdAt DESC
      const snap = await col
        .where('assignedTo', '==', uid)
        .where('CaApproval', '==', 'Pending')
        .where('AdminApproval', '==', 'Pending')
        .get();
      rawDocs = snap.docs.map(d => ({ _id: d.id, ...d.data() }));

    } else if (filter === 'assigned-resolved') {
      // Composite index: assignedTo ASC, AdminApproval ASC, createdAt DESC
      const snap = await col
        .where('assignedTo', '==', uid)
        .where('AdminApproval', '==', 'Approved')
        .get();
      rawDocs = snap.docs.map(d => ({ _id: d.id, ...d.data() }));

    } else if (filter === 'created-unresolved') {
      // Composite index: createdBy ASC, AdminApproval ASC, createdAt DESC
      const snap = await col
        .where('createdBy', '==', uid)
        .where('AdminApproval', '==', 'Pending')
        .get();
      rawDocs = snap.docs.map(d => ({ _id: d.id, ...d.data() }));

    } else if (filter === 'created-resolved') {
      // Fetch by createdBy, filter in-process for OR conditions
      const snap = await col.where('createdBy', '==', uid).get();
      rawDocs = snap.docs
        .map(d => ({ _id: d.id, ...d.data() }))
        .filter(d => {
          const doc = d as DocumentData;
          return (doc['CaApproval'] === 'Approved' || doc['assignedTo'] === 'No One') &&
            (doc['AdminApproval'] === 'Approved' || doc['AdminApproval'] === 'Rejected');
        });

    } else if (filter === 'admin-moved') {
      const denied = await checkPageAccess(uid, 'ca-admin');
      if (denied) return denied;
      const limit = Math.min(MOVED_MAX_LIMIT, Math.max(1, parseInt(searchParams.get('limit') ?? '') || MOVED_DEFAULT_LIMIT));
      const cutoff = Timestamp.fromMillis(Date.now() - MOVED_WINDOW_DAYS * 86_400_000);
      const windowed = col.where('approvedAt', '>=', cutoff);
      const [snap, count] = await Promise.all([
        windowed.orderBy('approvedAt', 'desc').limit(limit).get(),
        // An aggregation: one read per thousand matches, not one per dispute.
        windowed.count().get(),
      ]);
      const disputes = await serialiseDisputes(snap.docs.map(d => ({ _id: d.id, ...d.data() })));
      return NextResponse.json({ disputes, total: count.data().count, windowDays: MOVED_WINDOW_DAYS });

    } else if (filter === 'admin-ruling') {
      const denied = await checkPageAccess(uid, 'ca-admin');
      if (denied) return denied;
      const snap = await col.where('assignedTo', '==', NO_ONE).where('AdminApproval', '==', 'Pending').get();
      const waiting = snap.docs.map(d => ({ _id: d.id, ...d.data() }) as DocumentData & { _id: string }).sort(byNewest);
      const disputes = await serialiseDisputes(waiting);
      return NextResponse.json({ disputes, total: disputes.length, totalPages: 1 });

    } else {
      return NextResponse.json({ error: 'Invalid filter' }, { status: 400 });
    }

    const { paginated, total, totalPages } = sortAndPaginate(rawDocs, page);

    if (paginated.length === 0) {
      return NextResponse.json({ disputes: [], total: 0, totalPages: 1 });
    }

    const disputes = await serialiseDisputes(paginated as (DocumentData & { _id: string })[]);

    return NextResponse.json({ disputes, total, totalPages });
  } catch (error) {
    console.error('[disputes GET]', error);
    return NextResponse.json({ error: 'Failed to fetch disputes' }, { status: 500 });
  }
});

// ─── POST /api/disputes ───────────────────────────────────────────────
//
// Body: `{ saleIds: string[], Comment: string }` — disputes v2.
//
// The agent picks sales — tips and PPVs — from the sale search (`/api/ca-sales/search`) rather
// than typing a sale's details, because an approval now *moves* the sale inside
// Bluu Backend (documentation/buddyx.md §4). One submission becomes one dispute
// per current holder, linked by `groupId`. The holder's approval is final and
// moves the sales; an unassigned sale has no holder, so its dispute goes to an
// admin (CA Admin → Sales, "needs a ruling").
//
// All-or-nothing: if any sale cannot be claimed (already disputed, a
// finalised month…) nothing is written and every refusal comes back, so the
// dialog can mark those rows and keep the rest of the claim. The freeform v1
// create path is gone; v1 disputes stay readable and decidable.

export const POST = withAuth(async (request: NextRequest, token: DecodedIdToken) => {
  // Gated on `ca-dashboard`, not the retired `ca-disputes`: filing a dispute is
  // a control on the dashboard now (the Sale Disputes column's New dispute
  // button), and the pageId that used to guard it no longer exists — a
  // `checkPageAccess` against a pruned page would refuse everyone. The write is
  // hard-scoped to `createdBy: token.uid`, and the sales it may claim are
  // decided server-side by `claimRefusal`, never by the client.
  const denied = await checkPageAccess(token.uid, 'ca-dashboard');
  if (denied) return denied;

  try {
    const parsed = await readJsonBody(request, 16 * 1024);
    if (!parsed.ok) return parsed.response;
    const { saleIds, Comment } = parsed.body as { saleIds?: unknown; Comment?: unknown };

    const comment = typeof Comment === 'string' ? Comment.trim() : '';
    if (!comment) {
      return NextResponse.json({ error: 'A comment is required — it is the whole basis of the decision.' }, { status: 400 });
    }
    if (comment.length > MAX_COMMENT) {
      return NextResponse.json({ error: `Keep the comment under ${MAX_COMMENT} characters.` }, { status: 400 });
    }
    if (!Array.isArray(saleIds) || saleIds.length === 0 || !saleIds.every(id => typeof id === 'string' && id)) {
      return NextResponse.json({ error: 'Pick at least one sale to claim.' }, { status: 400 });
    }
    const unique = [...new Set(saleIds as string[])];
    if (unique.length > MAX_DISPUTE_SALES) {
      return NextResponse.json({ error: `A claim can include at most ${MAX_DISPUTE_SALES} sales.` }, { status: 400 });
    }

    const outcome = await fileDisputes({ filerUid: token.uid, saleIds: unique, comment });
    if (!outcome.ok) {
      return NextResponse.json(
        {
          error: `${outcome.refused.length} of these sales can no longer be claimed.`,
          refused: outcome.refused.map(r => ({ ...r, label: CLAIM_REFUSAL_LABEL[r.reason] })),
        },
        { status: 409 },
      );
    }

    return NextResponse.json({ success: true, groupId: outcome.groupId, disputes: outcome.disputes });
  } catch (error) {
    console.error('[disputes POST]', error);
    return NextResponse.json({ error: 'Failed to create dispute' }, { status: 500 });
  }
});
