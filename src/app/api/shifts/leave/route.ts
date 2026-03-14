import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { adminDb } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { getUserById, invalidateUserCache } from '@/lib/services/userService';
import type { DecodedIdToken } from 'firebase-admin/auth';
import type { LeaveRequestDocument } from '@/types/firestore';

function serialiseLeave(doc: LeaveRequestDocument) {
  return {
    leaveId: doc.leaveId,
    shiftId: doc.shiftId,
    occurrenceStart: doc.occurrenceStart,
    userId: doc.userId,
    leaveType: doc.leaveType,
    status: doc.status,
    requestedAt: doc.requestedAt?.toDate?.()?.toISOString() ?? null,
    resolvedAt: doc.resolvedAt?.toDate?.()?.toISOString() ?? null,
    resolvedBy: doc.resolvedBy ?? null,
  };
}

// ─── GET /api/shifts/leave?userId=uid ─────────────────────────────────────────

export const GET = withAuth(async (request: NextRequest, token: DecodedIdToken) => {
  try {
    const { searchParams } = new URL(request.url);
    const targetUserId = searchParams.get('userId') ?? token.uid;

    // Non-self requests require shift-management access
    if (targetUserId !== token.uid) {
      const caller = await getUserById(token.uid);
      if (!caller?.permittedPageIds?.includes('shift-management')) {
        return NextResponse.json({ error: 'Access denied' }, { status: 403 });
      }
    }

    const snap = await adminDb
      .collection('leave_requests')
      .where('userId', '==', targetUserId)
      .get();

    const leaveRequests = snap.docs.map(d => serialiseLeave(d.data() as LeaveRequestDocument));

    return NextResponse.json({ leaveRequests });
  } catch (err) {
    console.error('[shifts/leave GET]', err);
    return NextResponse.json({ error: 'Failed to fetch leave requests' }, { status: 500 });
  }
});

// ─── POST /api/shifts/leave ──────────────────────────────────────────────────

export const POST = withAuth(async (request: NextRequest, token: DecodedIdToken) => {
  try {
    const body = await request.json();
    const { shiftId, occurrenceStart, leaveType } = body as {
      shiftId: string;
      occurrenceStart: number;
      leaveType: 'paid' | 'unpaid';
    };

    if (!shiftId || typeof occurrenceStart !== 'number' || !['paid', 'unpaid'].includes(leaveType)) {
      return NextResponse.json({ error: 'Missing or invalid fields' }, { status: 400 });
    }

    // Users can only request leave for themselves
    const user = await getUserById(token.uid);
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Check leave balance
    if (leaveType === 'unpaid') {
      const remaining = user.remainingUnpaidLeave ?? 0;
      if (remaining <= 0) {
        return NextResponse.json({ error: 'No unpaid leave remaining' }, { status: 400 });
      }
    } else {
      if (!user.hasPaidLeave) {
        return NextResponse.json({ error: 'Paid leave is not enabled for this user' }, { status: 400 });
      }
      const remaining = user.remainingPaidLeave ?? 0;
      if (remaining <= 0) {
        return NextResponse.json({ error: 'No paid leave remaining' }, { status: 400 });
      }
    }

    // Duplicate check: one request per shift occurrence per user
    const existing = await adminDb
      .collection('leave_requests')
      .where('shiftId', '==', shiftId)
      .where('occurrenceStart', '==', occurrenceStart)
      .where('userId', '==', token.uid)
      .get();

    if (!existing.empty) {
      return NextResponse.json({ error: 'Leave request already exists for this shift occurrence' }, { status: 409 });
    }

    const leaveRef = adminDb.collection('leave_requests').doc();
    const leaveId = leaveRef.id;
    const balanceField = leaveType === 'paid' ? 'remainingPaidLeave' : 'remainingUnpaidLeave';

    // Atomically create the leave request and decrement the balance
    const batch = adminDb.batch();
    batch.set(leaveRef, {
      leaveId,
      shiftId,
      occurrenceStart,
      userId: token.uid,
      leaveType,
      status: 'pending',
      requestedAt: FieldValue.serverTimestamp(),
      resolvedAt: null,
      resolvedBy: null,
    });
    batch.update(adminDb.collection('users').doc(token.uid), {
      [balanceField]: FieldValue.increment(-1),
    });
    await batch.commit();
    invalidateUserCache(token.uid);

    return NextResponse.json({ leaveId });
  } catch (err) {
    console.error('[shifts/leave POST]', err);
    return NextResponse.json({ error: 'Failed to create leave request' }, { status: 500 });
  }
});
