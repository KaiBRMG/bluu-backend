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
 * **Finalising notifies the agent; reopening does not.** "Your salary is
 * finalised and on the way" is the thing they have been waiting to hear.
 * Reopening is an admin correcting something mid-flight, and telling an agent
 * their locked month has come unlocked — before anyone knows what it will
 * settle at — invites a question nobody can answer yet. The admin tells them
 * when the figure is right again, which is the finalise that follows.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { handleApiError } from '@/lib/middleware/apiHelpers';
import { requireAdminClaim } from '@/lib/salary/salaryAuth';
import { finalizeMonth, reopenMonth, getFinalizedMonth } from '@/lib/services/caSalaryService';
import { getUserById } from '@/lib/services/userService';
import { formatMonthLabel, isMonthKey } from '@/lib/salary/salaryDate';
import { notifications } from '@/lib/notificationContent';
import { notifyUsers } from '@/lib/services/caNotifications';
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

      // Also resets the agent's leave (unpaid every month, paid on December) in
      // the same transaction — see `finalizeMonth`.
      const { month: frozen, leaveReset } = await finalizeMonth({
        userId,
        month,
        actorUid: token.uid,
        actorName,
        reason: trimmedReason,
      });

      // After the freeze and never fatal: the month is locked whether or not the
      // message lands, and a failed notification must not read as a failed
      // finalisation and invite a second attempt (which would 409).
      //
      // The figure itself is deliberately NOT in the copy. A salary is between
      // the agent and payroll, and a notification is mirrored to Telegram and
      // rendered in a tray that is readable over someone's shoulder.
      await notifyUsers([userId], notifications.salaryFinalized(formatMonthLabel(month)), {
        docIdFor: uid => `${uid}__salary-final-${month}`,
        label: 'salaryFinalized',
      });

      return NextResponse.json({
        status: 'finalized',
        totals: frozen.totals,
        // What the finalisation did to leave, so payroll's toast can say so.
        leaveReset: leaveReset
          ? {
              unpaid: 'remainingUnpaidLeave' in leaveReset,
              paid: 'remainingPaidLeave' in leaveReset,
            }
          : null,
      });
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
