import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { adminDb } from '@/lib/firebase-admin';
import { DocumentData } from 'firebase-admin/firestore';
import { byNewest, serialiseDisputes } from '@/lib/services/disputeSerialise';
import { checkPageAccess, readJsonBody } from '@/lib/middleware/apiHelpers';
import { fileDisputes } from '@/lib/services/disputeTransfer';
import { CLAIM_REFUSAL_LABEL, MAX_DISPUTE_SALES } from '@/lib/disputes/disputeRules';
import type { DecodedIdToken } from 'firebase-admin/auth';

const PAGE_SIZE = 10;
const MAX_COMMENT = 2000;

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
//           created-resolved | admin-all | admin-unresolved |
//           admin-ca-approved | admin-resolved
//   page: number (default 1)
//   createdBy, assignedTo, creator: optional admin-view filters

export const GET = withAuth(async (request: NextRequest, token: DecodedIdToken) => {
  try {
    const { searchParams } = new URL(request.url);
    const filter = searchParams.get('filter') ?? 'created-unresolved';
    const page = Math.max(1, parseInt(searchParams.get('page') ?? '1'));
    const filterCreatedBy = searchParams.get('createdBy');
    const filterAssignedTo = searchParams.get('assignedTo');
    const filterCreator = searchParams.get('creator');

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

    } else if (filter === 'admin-all') {
      const denied = await checkPageAccess(uid, 'ca-admin');
      if (denied) return denied;
      const snap = await col.orderBy('createdAt', 'desc').limit(500).get();
      rawDocs = snap.docs.map(d => ({ _id: d.id, ...d.data() }));

    } else if (filter === 'admin-unresolved') {
      const denied = await checkPageAccess(uid, 'ca-admin');
      if (denied) return denied;
      // Composite index: CaApproval ASC, AdminApproval ASC, createdAt DESC
      const snap = await col
        .where('CaApproval', '==', 'Pending')
        .where('AdminApproval', '==', 'Pending')
        .get();
      rawDocs = snap.docs.map(d => ({ _id: d.id, ...d.data() }));

    } else if (filter === 'admin-ca-approved') {
      const denied = await checkPageAccess(uid, 'ca-admin');
      if (denied) return denied;
      // Fetch all, filter in-process for OR condition
      const snap = await col.where('AdminApproval', '==', 'Pending').get();
      rawDocs = snap.docs
        .map(d => ({ _id: d.id, ...d.data() }))
        .filter(d => {
          const doc = d as DocumentData;
          return doc['CaApproval'] === 'Approved' || doc['assignedTo'] === 'No One';
        });

    } else if (filter === 'admin-resolved') {
      const denied = await checkPageAccess(uid, 'ca-admin');
      if (denied) return denied;
      // Two parallel queries merged — capped at 250 each to prevent unbounded reads
      const [approvedSnap, rejectedSnap] = await Promise.all([
        col.where('AdminApproval', '==', 'Approved').orderBy('createdAt', 'desc').limit(250).get(),
        col.where('AdminApproval', '==', 'Rejected').orderBy('createdAt', 'desc').limit(250).get(),
      ]);
      rawDocs = [
        ...approvedSnap.docs.map(d => ({ _id: d.id, ...d.data() })),
        ...rejectedSnap.docs.map(d => ({ _id: d.id, ...d.data() })),
      ];

    } else {
      return NextResponse.json({ error: 'Invalid filter' }, { status: 400 });
    }

    // Apply optional admin UI filters in-process
    if (filterCreatedBy) rawDocs = rawDocs.filter(d => d.createdBy === filterCreatedBy);
    if (filterAssignedTo) rawDocs = rawDocs.filter(d => d.assignedTo === filterAssignedTo);
    if (filterCreator) rawDocs = rawDocs.filter(d => d.Creator === filterCreator);

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
// The agent picks tips from the sale search (`/api/ca-sales/search`) rather
// than typing a sale's details, because an approval now *moves* the sale inside
// Bluu Backend (documentation/buddyx.md §4). One submission becomes one dispute
// per current holder, linked by `groupId`; an unassigned tip has no holder to
// approve, so its dispute goes straight to admin.
//
// All-or-nothing: if any tip cannot be claimed (a PPV, already disputed, a
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
      return NextResponse.json({ error: 'Pick at least one tip to claim.' }, { status: 400 });
    }
    const unique = [...new Set(saleIds as string[])];
    if (unique.length > MAX_DISPUTE_SALES) {
      return NextResponse.json({ error: `A claim can include at most ${MAX_DISPUTE_SALES} tips.` }, { status: 400 });
    }

    const outcome = await fileDisputes({ filerUid: token.uid, saleIds: unique, comment });
    if (!outcome.ok) {
      const ppv = outcome.refused.some(r => r.reason === 'ppv');
      return NextResponse.json(
        {
          error: ppv
            ? CLAIM_REFUSAL_LABEL.ppv
            : `${outcome.refused.length} of these tips can no longer be claimed.`,
          refused: outcome.refused.map(r => ({ ...r, label: CLAIM_REFUSAL_LABEL[r.reason] })),
        },
        { status: ppv ? 400 : 409 },
      );
    }

    return NextResponse.json({ success: true, groupId: outcome.groupId, disputes: outcome.disputes });
  } catch (error) {
    console.error('[disputes POST]', error);
    return NextResponse.json({ error: 'Failed to create dispute' }, { status: 500 });
  }
});
