import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { adminDb } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { getUserById } from '@/lib/services/userService';
import { resolveLeaveBalances } from '@/lib/leave/leaveBalance';
import { notifications } from '@/lib/notificationContent';
import { CA_LEAVE_ALERT_RECIPIENT_UID, notifyUsers } from '@/lib/services/caNotifications';
import { formatDayLabelWithWeekday, toDayKey } from '@/lib/salary/salaryDate';
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
    reason: doc.reason ?? null,
  };
}



// ─── GET /api/shifts/leave?userId=uid ─────────────────────────────────────────

export const GET = withAuth(async (request: NextRequest, token: DecodedIdToken) => {
  try {
    const { searchParams } = new URL(request.url);
    const scope = searchParams.get('scope');

    // `scope=all` is the admin approvals inbox — every user's requests, with the
    // requester's name resolved so the queue is readable without an N+1 per row.
    // It requires shift-management OR ca-admin: leave approval is a CA payroll
    // concern as much as a rostering one, and the release it triggers is what
    // puts accounts on the overtime board.
    if (scope === 'all') {
      const caller = await getUserById(token.uid);
      const permitted = caller?.permittedPageIds ?? [];
      if (!permitted.includes('shift-management') && !permitted.includes('ca-admin')) {
        return NextResponse.json({ error: 'Access denied' }, { status: 403 });
      }

      const statusFilter = searchParams.get('status');
      let query = adminDb.collection('leave_requests').limit(400);
      if (statusFilter && ['pending', 'approved', 'denied'].includes(statusFilter)) {
        query = query.where('status', '==', statusFilter).limit(400);
      }

      const snap = await query.get();
      const rows = snap.docs.map(d => serialiseLeave(d.data() as LeaveRequestDocument));

      const uids = [...new Set(rows.map(r => r.userId))];
      const names = new Map<string, { displayName: string; photoURL: string | null }>();
      if (uids.length > 0) {
        const snaps = await adminDb.getAll(...uids.map(uid => adminDb.collection('users').doc(uid)));
        for (const userSnap of snaps) {
          if (userSnap.exists) {
            const data = userSnap.data();
            names.set(userSnap.id, { displayName: data?.displayName ?? userSnap.id, photoURL: data?.photoURL ?? null });
          }
        }
      }

      return NextResponse.json({
        leaveRequests: rows
          .map(row => ({
            ...row,
            displayName: names.get(row.userId)?.displayName ?? null,
            photoURL: names.get(row.userId)?.photoURL ?? null,
          }))
          // Soonest shift first: the one about to become uncoverable is the one
          // that needs deciding.
          .sort((a, b) => a.occurrenceStart - b.occurrenceStart),
      });
    }

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
    const { shiftId, occurrenceStart, leaveType, reason } = body as {
      shiftId: string;
      occurrenceStart: number;
      leaveType: 'paid' | 'unpaid';
      reason?: string;
    };

    if (!shiftId || typeof occurrenceStart !== 'number' || !['paid', 'unpaid'].includes(leaveType)) {
      return NextResponse.json({ error: 'Missing or invalid fields' }, { status: 400 });
    }

    // The only hard boundary: a shift that has already started cannot be taken
    // off. Everything before that is allowed.
    //
    // The 4-day notice period is **guidance, not a rule** — deliberately. An
    // agent who is ill tomorrow still has to tell someone, and a system that
    // refuses the request just moves that conversation somewhere nobody can see
    // it. The UI states the expectation; the admin sees how much notice a
    // request actually carries ("in 1 day") in the approvals queue and decides.
    if (occurrenceStart <= Date.now()) {
      return NextResponse.json({ error: 'That shift has already started.' }, { status: 400 });
    }

    // Paid leave needs a stated reason; unpaid does not. The asymmetry is the
    // existing policy, not an invention — paid leave is approved on its merits.
    const trimmedReason = typeof reason === 'string' ? reason.trim().slice(0, 500) : '';
    if (leaveType === 'paid' && trimmedReason.length < 3) {
      return NextResponse.json(
        { error: 'Paid leave needs a short reason so it can be reviewed.' },
        { status: 400 },
      );
    }

    // Users can only request leave for themselves
    const user = await getUserById(token.uid);
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    if (leaveType === 'paid' && !user.hasPaidLeave) {
      return NextResponse.json({ error: 'Paid leave is not enabled for this user' }, { status: 400 });
    }

    // ── The balance check, against what is left *after* everything already in
    //    flight ──
    //
    // A request no longer spends the balance; approval does (see the approve
    // route). That is the right model — a request an admin never gets to must
    // not hold someone's days hostage, and a denied request should cost nothing
    // — but it means the balance alone is not what an agent has left to spend.
    // Four pending requests against four days is fully committed, and checking
    // only `remaining` would let them queue a fifth.
    //
    // So the gate is `remaining - pending`. The pending count is the same
    // indexed `userId` query the duplicate check below needs anyway.
    const ownRequests = await adminDb
      .collection('leave_requests')
      .where('userId', '==', token.uid)
      .get();

    const requests = ownRequests.docs.map(d => d.data() as LeaveRequestDocument);

    // Duplicate check: one request per shift occurrence per user.
    if (requests.some(r => r.shiftId === shiftId && r.occurrenceStart === occurrenceStart)) {
      return NextResponse.json({ error: 'Leave request already exists for this shift occurrence' }, { status: 409 });
    }

    const balances = resolveLeaveBalances(user);
    const remaining = leaveType === 'paid' ? balances.paid : balances.unpaid;
    const pending = requests.filter(r => r.status === 'pending' && r.leaveType === leaveType).length;
    const uncommitted = remaining - pending;

    if (uncommitted <= 0) {
      const label = leaveType === 'paid' ? 'paid' : 'unpaid';
      return NextResponse.json(
        {
          error:
            pending > 0
              ? `You have ${remaining} ${label} ${remaining === 1 ? 'day' : 'days'} left and ${pending} ${pending === 1 ? 'request' : 'requests'} already awaiting approval.`
              : `No ${label} leave remaining.`,
        },
        { status: 400 },
      );
    }

    const leaveRef = adminDb.collection('leave_requests').doc();
    const leaveId = leaveRef.id;

    await leaveRef.set({
      leaveId,
      shiftId,
      occurrenceStart,
      userId: token.uid,
      leaveType,
      status: 'pending',
      requestedAt: FieldValue.serverTimestamp(),
      resolvedAt: null,
      resolvedBy: null,
      reason: trimmedReason || null,
    });

    // Tell the person who approves leave that there is something to approve.
    //
    // After the write and never fatal: the request exists, so a notification
    // failure must not 500 and invite the agent to submit it again — the second
    // attempt would 409 on the duplicate check and read as the app being broken.
    // The approvals queue is the source of truth either way; this is the nudge
    // towards it.
    await notifyUsers(
      [CA_LEAVE_ALERT_RECIPIENT_UID],
      notifications.leaveRequested(
        user.displayName ?? token.email ?? token.uid,
        leaveType,
        formatDayLabelWithWeekday(toDayKey(occurrenceStart)),
        trimmedReason || undefined,
      ),
      { label: 'leaveRequested' },
    );

    return NextResponse.json({ leaveId });
  } catch (err) {
    console.error('[shifts/leave POST]', err);
    return NextResponse.json({ error: 'Failed to create leave request' }, { status: 500 });
  }
});
