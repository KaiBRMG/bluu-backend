/**
 * GET /api/ca-salary/roster?month=YYYY-MM
 *
 * Every chat agent's month totals in one response — the payroll summary.
 *
 * Deliberately **not** a loop over `/month`: `buildSalaryMonthForUsers` reads
 * sales, overrides and shifts once for the whole roster and then runs the pure
 * engine per agent, so adding a ninth agent costs no extra Firestore query
 * (rule 9). Day rows are dropped from the response; the summary renders totals
 * and the drill-down fetches one agent's days on demand.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { handleApiError } from '@/lib/middleware/apiHelpers';
import { requireCaAdmin } from '@/lib/salary/salaryAuth';
import { buildSalaryMonthForUsers } from '@/lib/services/caSalaryService';
import { adminDb } from '@/lib/firebase-admin';
import { currentMonthKey, isMonthKey } from '@/lib/salary/salaryDate';
import type { DecodedIdToken } from 'firebase-admin/auth';

export const GET = withAuth(async (request: NextRequest, token: DecodedIdToken) => {
  try {
    const denied = await requireCaAdmin(token);
    if (denied) return denied;

    const { searchParams } = new URL(request.url);
    const month = searchParams.get('month') ?? currentMonthKey();
    if (!isMonthKey(month)) {
      return NextResponse.json({ error: 'month must be YYYY-MM' }, { status: 400 });
    }

    // Chat agents are the CA group. Archived users are filtered out rather than
    // queried out — `isArchived` is absent on most documents, and an inequality
    // filter on a missing field excludes the very rows we want (rule 6).
    const snap = await adminDb.collection('users').where('groups', 'array-contains', 'CA').get();
    const agents = snap.docs
      .map(d => d.data())
      .filter(u => u.isArchived !== true)
      .sort((a, b) => (a.displayName ?? '').localeCompare(b.displayName ?? ''));

    const months = await buildSalaryMonthForUsers(
      agents.map(a => a.uid),
      month,
    );

    const rows = agents.map(agent => {
      const result = months.get(agent.uid);
      return {
        uid: agent.uid,
        displayName: agent.displayName ?? agent.uid,
        photoURL: agent.photoURL ?? null,
        workEmail: agent.workEmail ?? null,
        totals: result?.totals ?? null,
        tier: result?.tier ?? null,
        status: result?.status ?? 'open',
        finalizedAt: result?.finalizedAt ?? null,
        finalizedByName: result?.finalizedByName ?? null,
        /** Days carrying an admin edit — the grid badges the row so an edit is never invisible. */
        overriddenDays: result ? result.days.filter(d => Object.keys(d.overrides).length > 0).length : 0,
        /** Days with sales but no shift — hours could not be derived and the wage is probably wrong. */
        missingShiftDays: result ? result.days.filter(d => d.missingShift).length : 0,
      };
    });

    const payrollTotal = rows.reduce((sum, r) => sum + (r.totals?.salary ?? 0), 0);

    return NextResponse.json({
      month,
      rows,
      payrollTotal: Math.round(payrollTotal * 100) / 100,
      finalizedCount: rows.filter(r => r.status === 'finalized').length,
    });
  } catch (err) {
    return handleApiError(err, 'ca-salary/roster GET');
  }
});
