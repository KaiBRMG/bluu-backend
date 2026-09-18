import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { adminDb } from '@/lib/firebase-admin';
import { getUserById } from '@/lib/services/userService';
import { FieldValue, Timestamp, DocumentData } from 'firebase-admin/firestore';
import { byNewest, serialiseDisputes } from '@/lib/services/disputeSerialise';
import { checkPageAccess, addNotificationToBatch } from '@/lib/middleware/apiHelpers';
import { notifications } from '@/lib/notificationContent';
import { sendTelegramNotification } from '@/lib/services/telegramService';
import type { DecodedIdToken } from 'firebase-admin/auth';

const PAGE_SIZE = 10;

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

export const POST = withAuth(async (request: NextRequest, token: DecodedIdToken) => {
  // Gated on `ca-dashboard`, not the retired `ca-disputes`: filing a dispute is
  // a control on the dashboard now (the Sale Disputes column's New dispute
  // button), and the pageId that used to guard it no longer exists — a
  // `checkPageAccess` against a pruned page would refuse everyone. The tier is
  // unchanged in substance: the write is hard-scoped to `createdBy: token.uid`
  // and to a sale the caller names, so page access decides who may *reach* the
  // form, never whose report a sale can be claimed off.
  const denied = await checkPageAccess(token.uid, 'ca-dashboard');
  if (denied) return denied;

  try {
    const body = await request.json();
    const { assignedTo, Creator, saleDate, saleAmount, fanName, Comment } = body;

    // All fields required
    if (!assignedTo || !Creator || !saleDate || saleAmount == null || !fanName || !Comment) {
      return NextResponse.json({ error: 'All fields are required' }, { status: 400 });
    }

    const disputeData = {
      createdBy: token.uid,
      assignedTo,
      Creator,
      saleDate: Timestamp.fromDate(new Date(saleDate)),
      saleAmount: Number(saleAmount),
      fanName,
      Comment,
      CaApproval: 'Pending',
      AdminApproval: 'Pending',
      createdAt: FieldValue.serverTimestamp(),
    };

    if (assignedTo !== 'No One') {
      // Use a batch to atomically write dispute + notification
      const batch = adminDb.batch();
      const disputeRef = adminDb.collection('disputes').doc();
      batch.set(disputeRef, disputeData);

      const createdByUser = await getUserById(token.uid);
      const createdByName = createdByUser?.displayName ?? 'Someone';

      const content = notifications.disputeAssigned(createdByName);
      addNotificationToBatch(batch, assignedTo, content);

      await batch.commit();
      await sendTelegramNotification([assignedTo], content);
    } else {
      await adminDb.collection('disputes').add(disputeData);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[disputes POST]', error);
    return NextResponse.json({ error: 'Failed to create dispute' }, { status: 500 });
  }
});
