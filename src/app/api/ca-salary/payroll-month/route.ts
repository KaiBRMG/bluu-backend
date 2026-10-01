/**
 * GET /api/ca-salary/payroll-month
 *
 * The month CA Admin opens on: last month while any agent still has it
 * unfinalised, otherwise this month (`resolvePayrollMonth`). On the 1st the
 * calendar moves on but payroll has not, and a page that jumped to the new
 * month would put the month that still needs paying one picker-click away.
 *
 * Cacheability (rule 9i): the answer is the same for every admin, but the
 * route is behind `withAuth`, so only the browser cache is available —
 * `private, max-age` + `Vary: Authorization`. A minute is short enough that a
 * reload after finalising the last agent moves on promptly.
 */

import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { handleApiError } from '@/lib/middleware/apiHelpers';
import { requireCaAdmin } from '@/lib/salary/salaryAuth';
import { resolvePayrollMonth } from '@/lib/services/caSalaryService';
import type { DecodedIdToken } from 'firebase-admin/auth';

export const GET = withAuth(async (_request, token: DecodedIdToken) => {
  try {
    const denied = await requireCaAdmin(token);
    if (denied) return denied;

    const month = await resolvePayrollMonth();
    return NextResponse.json(
      { month },
      { headers: { 'Cache-Control': 'private, max-age=60', Vary: 'Authorization' } },
    );
  } catch (err) {
    return handleApiError(err, 'ca-salary/payroll-month GET');
  }
});
