/**
 * PUT    /api/ca-salary/override   — set one field on one day (or a day note)
 * DELETE /api/ca-salary/override   — revert one field, or the whole day
 *
 * An override is an *instruction*, not a stored figure: the engine applies it on
 * every read and recomputes everything downstream. That is what lets a re-import
 * land without clobbering an edit, and what makes "revert to computed" a delete
 * rather than a restore.
 *
 * A finalised month refuses both. The whole point of finalising is that the
 * numbers stop moving — reopen it first, which is recorded.
 */

import { NextRequest, NextResponse, after } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { handleApiError } from '@/lib/middleware/apiHelpers';
import { notifications } from '@/lib/notificationContent';
import { notifyUsers, syncCommissionTierNotice } from '@/lib/services/caNotifications';
import { formatMonthLabel } from '@/lib/salary/salaryDate';
import { formatPercent } from '@/lib/salary/salaryFormat';
import { requireCaAdmin } from '@/lib/salary/salaryAuth';
import {
  buildSalaryMonth,
  clearDayOverrides,
  clearOverrideField,
  getFinalizedMonth,
  setDayNote,
  setOverrideField,
} from '@/lib/services/caSalaryService';
import { getUserById } from '@/lib/services/userService';
import { isDayKey, monthOfDay } from '@/lib/salary/salaryDate';
import { SALARY_OVERRIDE_FIELDS, type SalaryOverrideField } from '@/lib/salary/salaryTypes';
import type { DecodedIdToken } from 'firebase-admin/auth';

/** Upper bounds that catch a fat-fingered entry before it becomes a payout. */
const FIELD_LIMITS: Record<SalaryOverrideField, { min: number; max: number }> = {
  grossEarnings: { min: -1_000_000, max: 1_000_000 },
  hours: { min: 0, max: 24 },
  accountCount: { min: 0, max: 20 },
  hourlyRate: { min: 0, max: 1_000 },
  commissionPercent: { min: 0, max: 100 },
  commission: { min: -1_000_000, max: 1_000_000 },
  wage: { min: -1_000_000, max: 1_000_000 },
  salary: { min: -1_000_000, max: 1_000_000 },
};

function isOverrideField(value: unknown): value is SalaryOverrideField {
  return typeof value === 'string' && (SALARY_OVERRIDE_FIELDS as readonly string[]).includes(value);
}

async function guard(token: DecodedIdToken, userId: unknown, day: unknown) {
  const denied = await requireCaAdmin(token);
  if (denied) return denied;

  if (typeof userId !== 'string' || !userId) {
    return NextResponse.json({ error: 'userId is required' }, { status: 400 });
  }
  if (!isDayKey(day)) {
    return NextResponse.json({ error: 'day must be YYYY-MM-DD' }, { status: 400 });
  }
  if (await getFinalizedMonth(userId, monthOfDay(day))) {
    return NextResponse.json(
      { error: 'This month is finalised. Reopen it before editing.' },
      { status: 409 },
    );
  }
  return null;
}

export const PUT = withAuth(async (request: NextRequest, token: DecodedIdToken) => {
  try {
    const body = (await request.json()) as {
      userId?: string;
      day?: string;
      field?: string;
      value?: number;
      reason?: string;
      note?: string | null;
    };

    const blocked = await guard(token, body.userId, body.day);
    if (blocked) return blocked;

    const userId = body.userId as string;
    const day = body.day as string;
    const actor = await getUserById(token.uid);
    const actorName = actor?.displayName ?? token.email ?? token.uid;

    // A note carries no number, so it takes the same endpoint but its own branch.
    if (body.note !== undefined) {
      const note = typeof body.note === 'string' ? body.note.trim().slice(0, 500) : null;
      await setDayNote(userId, day, note || null);
    } else {
      if (!isOverrideField(body.field)) {
        return NextResponse.json(
          { error: `field must be one of: ${SALARY_OVERRIDE_FIELDS.join(', ')}` },
          { status: 400 },
        );
      }
      if (typeof body.value !== 'number' || !Number.isFinite(body.value)) {
        return NextResponse.json({ error: 'value must be a number' }, { status: 400 });
      }

      const limit = FIELD_LIMITS[body.field];
      if (body.value < limit.min || body.value > limit.max) {
        return NextResponse.json(
          { error: `${body.field} must be between ${limit.min} and ${limit.max}` },
          { status: 400 },
        );
      }

      await setOverrideField({
        userId,
        day,
        field: body.field,
        value: body.value,
        actorUid: token.uid,
        actorName,
        reason: typeof body.reason === 'string' ? body.reason.trim().slice(0, 280) : undefined,
      });
    }

    // Return the recomputed month so the grid re-renders from the server's
    // arithmetic rather than guessing what an edit did downstream — an override
    // can move the commission tier on every later day, which no optimistic
    // client-side patch could reproduce.
    const month = await buildSalaryMonth(userId, monthOfDay(day));
    announceTierCrossing(userId, monthOfDay(day), month.tier.currentPercent);
    return NextResponse.json(month);
  } catch (err) {
    return handleApiError(err, 'ca-salary/override PUT');
  }
});

export const DELETE = withAuth(async (request: NextRequest, token: DecodedIdToken) => {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');
    const day = searchParams.get('day');
    const field = searchParams.get('field');

    const blocked = await guard(token, userId, day);
    if (blocked) return blocked;

    if (field === null || field === 'all') {
      await clearDayOverrides(userId as string, day as string);
    } else {
      if (!isOverrideField(field)) {
        return NextResponse.json({ error: 'Unknown field' }, { status: 400 });
      }
      await clearOverrideField(userId as string, day as string, field);
    }

    const month = await buildSalaryMonth(userId as string, monthOfDay(day as string));
    announceTierCrossing(userId as string, monthOfDay(day as string), month.tier.currentPercent);
    return NextResponse.json(month);
  } catch (err) {
    return handleApiError(err, 'ca-salary/override DELETE');
  }
});

/**
 * An override can move the commission tier — that is the whole point of the
 * ratchet — so the same once-per-band gate the sales import uses is applied
 * here, against the month this route has already recomputed.
 *
 * Fire-and-forget through `after()`: the grid is waiting on this response, and
 * an admin nudging a cell should never pay for a notification round trip. Only
 * an *increase* is announced; `syncCommissionTierNotice` owns that decision and
 * the memory it needs.
 */
function announceTierCrossing(userId: string, month: string, currentPercent: number): void {
  after(async () => {
    try {
      const { crossedTo } = await syncCommissionTierNotice({ userId, month, currentPercent });
      if (crossedTo === null) return;
      await notifyUsers(
        [userId],
        notifications.commissionTierUp(formatPercent(crossedTo), formatMonthLabel(month)),
        { label: 'commissionTierUp' },
      );
    } catch (err) {
      console.error('[ca-salary/override] tier notification failed', err);
    }
  });
}
