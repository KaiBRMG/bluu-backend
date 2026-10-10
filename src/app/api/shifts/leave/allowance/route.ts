import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { withAuth } from '@/lib/middleware/withAuth';
import { adminDb } from '@/lib/firebase-admin';
import { invalidateUserCache } from '@/lib/services/userService';
import { checkPageAccess, handleApiError, readJsonBody } from '@/lib/middleware/apiHelpers';
import { invalidateAdminUsersCache } from '@/app/api/admin/users/route';
import { recordLeaveLedgerEntry } from '@/lib/services/leaveLedger';
import {
  DEFAULT_ALLOTMENT,
  MAX_ADJUSTMENT,
  MAX_ALLOTMENT,
  computeLeaveBalance,
  hasCustomAllotment,
  isLeavePeriod,
  leaveAdjustmentOf,
  leaveAllotmentOf,
  requestableMonths,
  STANDING_PERIOD,
  type LeaveBalance,
  type LeaveType,
} from '@/lib/leave/leaveBalance';
import { dayKeyToStartMs } from '@/lib/salary/salaryDate';
import type { DecodedIdToken } from 'firebase-admin/auth';
import type { LeaveRequestDocument, UserDocument } from '@/types/firestore';

// ─── /api/shifts/leave/allowance ─────────────────────────────────────────────
//
// The admin side of leave balances (see `leaveBalance.ts`): everyone's
// allowance and what is left of it, and the writes that change an allowance or
// make a one-off adjustment for one period.
//
// GET — Shift Management → Settings → Leave, and a person's Leave tab. Same
// tier as the approvals queue: shift-management or ca-admin.
//
// PUT — needs shift-management **and** user-management. That is exactly what
// editing a balance from Shift Management required before (the old write went
// through `PUT /api/admin/users/{uid}`, which is user-management), so moving the
// write here does not widen who can change someone's entitlement (rule 10).
//
// Uncached (rule 9i): it sits beside the queue whose decisions move it, and
// an admin who has just granted a day expects to see it.

export interface LeaveAllowanceRow {
  uid: string;
  displayName: string;
  workEmail: string | null;
  hasPaidLeave: boolean;
  allotment: { unpaid: number; paid: number; unpaidCustom: boolean; paidCustom: boolean };
  /** This month and next for unpaid; this year (and next, when next month is in it) for paid. */
  balances: { unpaid: LeaveBalance[]; paid: LeaveBalance[] };
}

export interface LeaveAllowanceResponse {
  defaults: { unpaidPerMonth: number; paidPerYear: number };
  periods: { unpaid: string[]; paid: string[] };
  people: LeaveAllowanceRow[];
}

function windowPeriods(now: number): { unpaid: string[]; paid: string[] } {
  const months = requestableMonths(now);
  const years = [...new Set(months.map(m => m.slice(0, 4)))];
  return { unpaid: months, paid: years };
}

function rowFor(uid: string, user: UserDocument, requests: LeaveRequestDocument[], periods: { unpaid: string[]; paid: string[] }): LeaveAllowanceRow {
  return {
    uid,
    displayName: user.displayName || 'Unnamed',
    workEmail: user.workEmail ?? null,
    hasPaidLeave: user.hasPaidLeave === true,
    allotment: {
      unpaid: leaveAllotmentOf(user, 'unpaid'),
      paid: leaveAllotmentOf(user, 'paid'),
      unpaidCustom: hasCustomAllotment(user, 'unpaid'),
      paidCustom: hasCustomAllotment(user, 'paid'),
    },
    balances: {
      unpaid: periods.unpaid.map(p => computeLeaveBalance(user, requests, 'unpaid', p)),
      paid: user.hasPaidLeave === true ? periods.paid.map(p => computeLeaveBalance(user, requests, 'paid', p)) : [],
    },
  };
}

export const GET = withAuth(async (request: NextRequest, token: DecodedIdToken) => {
  try {
    const denied = await checkPageAccess(token.uid, ['shift-management', 'ca-admin']);
    if (denied) return denied;

    const now = Date.now();
    const periods = windowPeriods(now);
    const only = new URL(request.url).searchParams.get('uid');

    // Every request that can count against a period on screen starts on or
    // after 1 January of the earliest year shown. One range query for everyone
    // (rule 9), split by person in memory.
    const fromMs = dayKeyToStartMs(`${periods.paid[0]}-01-01`);

    let users: Array<{ uid: string; data: UserDocument }>;
    let requestQuery = adminDb.collection('leave_requests').where('occurrenceStart', '>=', fromMs);
    if (only) {
      const snap = await adminDb.collection('users').doc(only).get();
      if (!snap.exists) return NextResponse.json({ error: 'User not found' }, { status: 404 });
      users = [{ uid: snap.id, data: snap.data() as UserDocument }];
      requestQuery = adminDb.collection('leave_requests').where('userId', '==', only);
    } else {
      const snap = await adminDb
        .collection('users')
        .select('displayName', 'workEmail', 'hasPaidLeave', 'leaveAllotment', 'leaveAdjustments', 'isArchived')
        .get();
      users = snap.docs
        .map(d => ({ uid: d.id, data: d.data() as UserDocument }))
        .filter(u => u.data.isArchived !== true);
    }

    const requestSnap = await requestQuery.get();
    const byUser = new Map<string, LeaveRequestDocument[]>();
    for (const doc of requestSnap.docs) {
      const leave = doc.data() as LeaveRequestDocument;
      const list = byUser.get(leave.userId);
      if (list) list.push(leave);
      else byUser.set(leave.userId, [leave]);
    }

    const body: LeaveAllowanceResponse = {
      defaults: { unpaidPerMonth: DEFAULT_ALLOTMENT.unpaid, paidPerYear: DEFAULT_ALLOTMENT.paid },
      periods,
      people: users
        .map(u => rowFor(u.uid, u.data, byUser.get(u.uid) ?? [], periods))
        .sort((a, b) => a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' })),
    };

    return NextResponse.json(body, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (err) {
    return handleApiError(err, 'shifts/leave/allowance GET');
  }
});

type PutBody = {
  uid?: unknown;
  /**
   * A number sets this person's own allotment; `null` — or the default itself —
   * returns them to the default, so a later change to the default reaches them.
   */
  allotment?: { unpaidPerMonth?: number | null; paidPerYear?: number | null };
  /** Sets (not adds) the one-off adjustment for one period. `0` removes it. */
  adjustment?: { type?: unknown; period?: unknown; days?: unknown; note?: unknown };
};

class Refusal extends Error {}

function validAllotment(type: LeaveType, value: unknown): value is number | null {
  return value === null || (Number.isInteger(value) && (value as number) >= 0 && (value as number) <= MAX_ALLOTMENT[type]);
}

export const PUT = withAuth(async (request: NextRequest, token: DecodedIdToken) => {
  try {
    const denied =
      (await checkPageAccess(token.uid, 'shift-management')) ?? (await checkPageAccess(token.uid, 'user-management'));
    if (denied) return denied;

    const parsed = await readJsonBody(request, 4_096);
    if (!parsed.ok) return parsed.response;
    const body = (parsed.body ?? {}) as PutBody;
    const uid = typeof body.uid === 'string' ? body.uid : '';
    if (!uid) return NextResponse.json({ error: 'uid is required' }, { status: 400 });

    const allotment = body.allotment;
    if (allotment) {
      if ('unpaidPerMonth' in allotment && !validAllotment('unpaid', allotment.unpaidPerMonth)) {
        return NextResponse.json({ error: `Unpaid days per month must be a whole number from 0 to ${MAX_ALLOTMENT.unpaid}.` }, { status: 400 });
      }
      if ('paidPerYear' in allotment && !validAllotment('paid', allotment.paidPerYear)) {
        return NextResponse.json({ error: `Paid days per year must be a whole number from 0 to ${MAX_ALLOTMENT.paid}.` }, { status: 400 });
      }
    }

    const adj = body.adjustment;
    let adjustment: { type: LeaveType; period: string; days: number; note: string } | null = null;
    if (adj) {
      const type = adj.type === 'paid' || adj.type === 'unpaid' ? adj.type : null;
      if (!type || !isLeavePeriod(type, adj.period)) {
        return NextResponse.json({ error: 'Adjustment needs a leave type and a matching period.' }, { status: 400 });
      }
      if (!Number.isInteger(adj.days) || Math.abs(adj.days as number) > MAX_ADJUSTMENT) {
        return NextResponse.json({ error: `An adjustment is a whole number of days from −${MAX_ADJUSTMENT} to ${MAX_ADJUSTMENT}.` }, { status: 400 });
      }
      const note = typeof adj.note === 'string' ? adj.note.trim().slice(0, 280) : '';
      // A one-off change to someone's leave is a decision somebody will later
      // ask about. The ledger keeps who; the note keeps why.
      if ((adj.days as number) !== 0 && note.length < 3) {
        return NextResponse.json({ error: 'Add a short note saying why this adjustment is being made.' }, { status: 400 });
      }
      adjustment = { type, period: adj.period as string, days: adj.days as number, note };
    }

    if (!allotment && !adjustment) {
      return NextResponse.json({ error: 'Nothing to change.' }, { status: 400 });
    }

    const userRef = adminDb.collection('users').doc(uid);

    try {
      await adminDb.runTransaction(async tx => {
        // The requests are only needed for an adjustment's before/after; an
        // allotment change records the allotment itself.
        const [userSnap, ownRequests] = await Promise.all([
          tx.get(userRef),
          adjustment ? tx.get(adminDb.collection('leave_requests').where('userId', '==', uid)) : null,
        ]);
        if (!userSnap.exists) throw new Refusal('User not found');
        const user = userSnap.data() as UserDocument;
        const requests = ownRequests?.docs.map(d => d.data() as LeaveRequestDocument) ?? [];

        const update: Record<string, unknown> = {};

        if (allotment) {
          const nextAllotment: Record<string, unknown> = {};
          for (const [field, type] of [['unpaidPerMonth', 'unpaid'], ['paidPerYear', 'paid']] as const) {
            if (!(field in allotment)) continue;
            const value = allotment[field] ?? null;
            const isDefault = value === null || value === DEFAULT_ALLOTMENT[type];
            const before = leaveAllotmentOf(user, type);
            const after = isDefault ? DEFAULT_ALLOTMENT[type] : value;
            nextAllotment[field] = isDefault ? FieldValue.delete() : value;
            if (before !== after) {
              recordLeaveLedgerEntry(tx, {
                userId: uid,
                leaveType: type,
                occurrenceStart: 0,
                action: 'allotment',
                before,
                after,
                actorUid: token.uid,
                period: STANDING_PERIOD,
              });
            }
          }
          update.leaveAllotment = nextAllotment;
        }

        if (adjustment) {
          const { type, period, days, note } = adjustment;
          const previous = leaveAdjustmentOf(user, type, period);
          if (previous !== days) {
            const before = computeLeaveBalance(user, requests, type, period).remaining;
            update.leaveAdjustments = { [type]: { [period]: days === 0 ? FieldValue.delete() : days } };
            recordLeaveLedgerEntry(tx, {
              userId: uid,
              leaveType: type,
              occurrenceStart: 0,
              action: 'adjusted',
              before,
              after: before + (days - previous),
              actorUid: token.uid,
              period,
              note: note || undefined,
            });
          }
        }

        if (Object.keys(update).length > 0) tx.set(userRef, update, { merge: true });
      });
    } catch (txErr) {
      if (txErr instanceof Refusal) return NextResponse.json({ error: txErr.message }, { status: 404 });
      throw txErr;
    }

    // Rule 2, and the admin roster cache that also carries these fields.
    invalidateUserCache(uid);
    invalidateAdminUsersCache();

    return NextResponse.json({ success: true });
  } catch (err) {
    return handleApiError(err, 'shifts/leave/allowance PUT');
  }
});
