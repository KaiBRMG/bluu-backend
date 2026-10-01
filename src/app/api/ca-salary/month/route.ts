/**
 * GET /api/ca-salary/month?month=YYYY-MM|open[&userId=uid]
 *
 * `month=open` lets the server pick: the previous month while it is unfinalised
 * and has activity, otherwise the current one (`buildDashboardSalaryMonth`). The
 * dashboard summary uses it so the card does not jump to a fresh $0 on the 1st
 * while last month is still waiting on payroll. The resolved month is the
 * response's `month` field — read that, never the query.
 *
 * One agent's month, fully computed. Serves both surfaces: an agent reading
 * their own (no `userId`, or their own uid) and the payroll grid reading
 * someone else's (`ca-admin` required). The response shape is identical, so the
 * admin grid and the agent's page share every component below the fetch.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { handleApiError } from '@/lib/middleware/apiHelpers';
import { resolveSalarySubject } from '@/lib/salary/salaryAuth';
import { buildDashboardSalaryMonth, buildSalaryMonth } from '@/lib/services/caSalaryService';
import { currentMonthKey, isMonthKey } from '@/lib/salary/salaryDate';
import { getUserById } from '@/lib/services/userService';
import type { DecodedIdToken } from 'firebase-admin/auth';

export const GET = withAuth(async (request: NextRequest, token: DecodedIdToken) => {
  try {
    const { searchParams } = new URL(request.url);
    const month = searchParams.get('month') ?? currentMonthKey();

    if (month !== 'open' && !isMonthKey(month)) {
      return NextResponse.json({ error: 'month must be YYYY-MM or "open"' }, { status: 400 });
    }

    const subject = await resolveSalarySubject(token, searchParams.get('userId'));
    if (subject instanceof NextResponse) return subject;

    const result = month === 'open'
      ? await buildDashboardSalaryMonth(subject.userId)
      : await buildSalaryMonth(subject.userId, month);

    // The admin grid labels rows; the agent's own view never needs this, so it
    // is only resolved for the admin path rather than on every dashboard load.
    const user = subject.isAdminView ? await getUserById(subject.userId) : null;

    return NextResponse.json({
      ...result,
      user: user ? { uid: user.uid, displayName: user.displayName, photoURL: user.photoURL ?? null } : null,
    });
  } catch (err) {
    return handleApiError(err, 'ca-salary/month GET');
  }
});
