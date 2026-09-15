/**
 * POST /api/ca-salary/finalize
 *   { userId, month, action: 'finalize' | 'reopen', reason? }
 *
 * Freezes a month at its computed values, or reopens a frozen one.
 *
 * **Admin claim, not page permission** (rule 3): finalising decides what was
 * paid and stops every later correction from reaching the figure. A page
 * permission is granted in two clicks on the Sharing screen; this is not that
 * kind of action.
 *
 * Reopening keeps the frozen snapshot and appends to the document's history, so
 * "what did we actually pay in August" stays answerable after the month goes
 * live again.
 *
 * Neither action notifies the agent yet. Salary notifications are held back
 * until the subsystem has run in production; until then an admin finalising a
 * month should tell the agent themselves.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { handleApiError } from '@/lib/middleware/apiHelpers';
import { requireAdminClaim } from '@/lib/salary/salaryAuth';
import { finalizeMonth, reopenMonth, getFinalizedMonth } from '@/lib/services/caSalaryService';
import { getUserById } from '@/lib/services/userService';
import { isMonthKey } from '@/lib/salary/salaryDate';
import type { DecodedIdToken } from 'firebase-admin/auth';

export const POST = withAuth(async (request: NextRequest, token: DecodedIdToken) => {
  try {
    const denied = requireAdminClaim(token);
    if (denied) return denied;

    const { userId, month, action, reason } = (await request.json()) as {
      userId?: string;
      month?: string;
      action?: 'finalize' | 'reopen';
      reason?: string;
    };

    if (!userId || typeof userId !== 'string') {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 });
    }
    if (!isMonthKey(month)) {
      return NextResponse.json({ error: 'month must be YYYY-MM' }, { status: 400 });
    }
    if (action !== 'finalize' && action !== 'reopen') {
      return NextResponse.json({ error: "action must be 'finalize' or 'reopen'" }, { status: 400 });
    }

    const [actor, subject] = await Promise.all([getUserById(token.uid), getUserById(userId)]);
    if (!subject) return NextResponse.json({ error: 'User not found' }, { status: 404 });

    const actorName = actor?.displayName ?? token.email ?? token.uid;
    const trimmedReason = typeof reason === 'string' ? reason.trim().slice(0, 280) : undefined;
    const already = await getFinalizedMonth(userId, month);

    if (action === 'finalize') {
      if (already) {
        return NextResponse.json({ error: 'This month is already finalised.' }, { status: 409 });
      }

      const frozen = await finalizeMonth({ userId, month, actorUid: token.uid, actorName, reason: trimmedReason });

      // NOTE: the agent is deliberately NOT notified yet. Salary notifications
      // are held back until the subsystem has run in production — see
      // documentation/ca-salary.md §11.
      return NextResponse.json({ status: 'finalized', totals: frozen.totals });
    }

    if (!already) {
      return NextResponse.json({ error: 'This month is not finalised.' }, { status: 409 });
    }

    await reopenMonth({ userId, month, actorUid: token.uid, actorName, reason: trimmedReason });

    return NextResponse.json({ status: 'open' });
  } catch (err) {
    return handleApiError(err, 'ca-salary/finalize POST');
  }
});
