import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { adminDb } from '@/lib/firebase-admin';
import { getUserById } from '@/lib/services/userService';
import { FieldValue, Timestamp, DocumentData } from 'firebase-admin/firestore';
import type { DecodedIdToken } from 'firebase-admin/auth';
import type { DisputeDocument } from '@/types/firestore';

const PAGE_SIZE = 10;

// ─── Helpers ─────────────────────────────────────────────────────────

interface UserInfo { displayName: string; photoURL: string | null; }

function serialiseDispute(
  id: string,
  data: DocumentData,
  userMap: Record<string, UserInfo>,
  creatorMap: Record<string, string>,
): DisputeDocument {
  const assignedToInfo = data.assignedTo === 'No One'
    ? { displayName: 'No One', photoURL: null }
    : (userMap[data.assignedTo] ?? { displayName: data.assignedTo, photoURL: null });
  const createdByInfo = userMap[data.createdBy] ?? { displayName: data.createdBy, photoURL: null };
  return {
    id,
    createdAt: data.createdAt?.toDate?.()?.toISOString() ?? null,
    saleDate: data.saleDate?.toDate?.()?.toISOString() ?? null,
    assignedTo: data.assignedTo,
    assignedToName: assignedToInfo.displayName,
    assignedToPhotoURL: assignedToInfo.photoURL,
    CaApproval: data.CaApproval,
    AdminApproval: data.AdminApproval,
    Creator: data.Creator,
    creatorName: creatorMap[data.Creator] ?? data.Creator,
    saleAmount: data.saleAmount,
    fanName: data.fanName,
    Comment: data.Comment,
    createdBy: data.createdBy,
    createdByName: createdByInfo.displayName,
    createdByPhotoURL: createdByInfo.photoURL,
  };
}

async function resolveNames(
  rawDocs: DocumentData[],
  ids: { createdBy: string; assignedTo: string; Creator: string }[],
) {
  // Batch-fetch all unique user docs in one round-trip
  const uniqueUids = [...new Set([
    ...ids.map(d => d.createdBy),
    ...ids.filter(d => d.assignedTo !== 'No One').map(d => d.assignedTo),
  ])];
  const userMap: Record<string, UserInfo> = {};
  if (uniqueUids.length > 0) {
    const userRefs = uniqueUids.map(uid => adminDb.collection('users').doc(uid));
    const userDocs = await adminDb.getAll(...userRefs);
    for (const doc of userDocs) {
      if (doc.exists) {
        userMap[doc.id] = {
          displayName: doc.data()?.displayName ?? doc.id,
          photoURL: doc.data()?.photoURL ?? null,
        };
      }
    }
  }

  // Batch-fetch creator names via 'in' query (max 30 per Firestore limit)
  const uniqueCreatorIds = [...new Set(ids.map(d => d.Creator).filter(Boolean))];
  const creatorMap: Record<string, string> = {};
  if (uniqueCreatorIds.length > 0) {
    const chunks: string[][] = [];
    for (let i = 0; i < uniqueCreatorIds.length; i += 30) {
      chunks.push(uniqueCreatorIds.slice(i, i + 30));
    }
    await Promise.all(chunks.map(async chunk => {
      const snap = await adminDb.collection('creators').where('creatorID', 'in', chunk).get();
      for (const doc of snap.docs) {
        creatorMap[doc.data().creatorID] = doc.data().stageName ?? doc.data().creatorID;
      }
    }));
  }

  return { userMap, creatorMap };
}

function sortAndPaginate(docs: DocumentData[], page: number) {
  docs.sort((a, b) => {
    const aMs = a.createdAt?.toMillis?.() ?? 0;
    const bMs = b.createdAt?.toMillis?.() ?? 0;
    return bMs - aMs;
  });
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
      const caller = await getUserById(uid);
      if (!caller?.permittedPageIds?.includes('ca-admin')) {
        return NextResponse.json({ error: 'Access denied' }, { status: 403 });
      }
      const snap = await col.get();
      rawDocs = snap.docs.map(d => ({ _id: d.id, ...d.data() }));

    } else if (filter === 'admin-unresolved') {
      const caller = await getUserById(uid);
      if (!caller?.permittedPageIds?.includes('ca-admin')) {
        return NextResponse.json({ error: 'Access denied' }, { status: 403 });
      }
      // Composite index: CaApproval ASC, AdminApproval ASC, createdAt DESC
      const snap = await col
        .where('CaApproval', '==', 'Pending')
        .where('AdminApproval', '==', 'Pending')
        .get();
      rawDocs = snap.docs.map(d => ({ _id: d.id, ...d.data() }));

    } else if (filter === 'admin-ca-approved') {
      const caller = await getUserById(uid);
      if (!caller?.permittedPageIds?.includes('ca-admin')) {
        return NextResponse.json({ error: 'Access denied' }, { status: 403 });
      }
      // Fetch all, filter in-process for OR condition
      const snap = await col.where('AdminApproval', '==', 'Pending').get();
      rawDocs = snap.docs
        .map(d => ({ _id: d.id, ...d.data() }))
        .filter(d => {
          const doc = d as DocumentData;
          return doc['CaApproval'] === 'Approved' || doc['assignedTo'] === 'No One';
        });

    } else if (filter === 'admin-resolved') {
      const caller = await getUserById(uid);
      if (!caller?.permittedPageIds?.includes('ca-admin')) {
        return NextResponse.json({ error: 'Access denied' }, { status: 403 });
      }
      // Two parallel queries merged
      const [approvedSnap, rejectedSnap] = await Promise.all([
        col.where('AdminApproval', '==', 'Approved').get(),
        col.where('AdminApproval', '==', 'Rejected').get(),
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

    const ids = paginated.map(d => ({
      createdBy: d.createdBy,
      assignedTo: d.assignedTo,
      Creator: d.Creator,
    }));
    const { userMap, creatorMap } = await resolveNames(paginated, ids);

    const disputes = paginated.map(d =>
      serialiseDispute(d._id as string, d, userMap, creatorMap)
    );

    return NextResponse.json({ disputes, total, totalPages });
  } catch (error) {
    console.error('[disputes GET]', error);
    return NextResponse.json({ error: 'Failed to fetch disputes' }, { status: 500 });
  }
});

// ─── POST /api/disputes ───────────────────────────────────────────────

export const POST = withAuth(async (request: NextRequest, token: DecodedIdToken) => {
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

      batch.set(adminDb.collection('notifications').doc(), {
        userId: assignedTo,
        title: 'New Dispute',
        message: `${createdByName} has submitted a dispute against a sale assigned to you. Click here to check it out ASAP!`,
        type: 'action',
        read: false,
        dismissedByUser: false,
        createdAt: FieldValue.serverTimestamp(),
        actionUrl: '/ca-portal/disputes',
        announcement: false,
        announcementExpiry: null,
      });

      await batch.commit();
    } else {
      await adminDb.collection('disputes').add(disputeData);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[disputes POST]', error);
    return NextResponse.json({ error: 'Failed to create dispute' }, { status: 500 });
  }
});
