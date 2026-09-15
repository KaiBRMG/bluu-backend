/**
 * GET    /api/ca-salary/sales?month=YYYY-MM[&userId=uid][&day=YYYY-MM-DD]
 * DELETE /api/ca-salary/sales?saleId=…  — remove a row a later export retracted
 *
 * The detailed sales report behind both the agent's salary page and the admin
 * grid: every individual sale, so a disputed daily total can be traced to the
 * transaction that caused it.
 *
 * Self-or-admin, same as `/month` — an agent sees their own rows and nobody
 * else's. Fan names are included because the agent is the person who talked to
 * that fan; they are the least surprising column on the page.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { handleApiError } from '@/lib/middleware/apiHelpers';
import { requireCaAdmin, resolveSalarySubject } from '@/lib/salary/salaryAuth';
import { getSalesForMonth, deleteSale, getFinalizedMonth } from '@/lib/services/caSalaryService';
import { currentMonthKey, isDayKey, isMonthKey } from '@/lib/salary/salaryDate';
import { round2 } from '@/lib/salary/salaryEngine';
import { adminDb } from '@/lib/firebase-admin';
import type { CaSaleDocument } from '@/types/firestore';
import type { DecodedIdToken } from 'firebase-admin/auth';

export const GET = withAuth(async (request: NextRequest, token: DecodedIdToken) => {
  try {
    const { searchParams } = new URL(request.url);
    const month = searchParams.get('month') ?? currentMonthKey();
    const day = searchParams.get('day');

    if (!isMonthKey(month)) {
      return NextResponse.json({ error: 'month must be YYYY-MM' }, { status: 400 });
    }
    if (day !== null && !isDayKey(day)) {
      return NextResponse.json({ error: 'day must be YYYY-MM-DD' }, { status: 400 });
    }

    const subject = await resolveSalarySubject(token, searchParams.get('userId'));
    if (subject instanceof NextResponse) return subject;

    const all = await getSalesForMonth(subject.userId, month);
    const sales = day ? all.filter(s => s.day === day) : all;

    // Summaries computed here rather than in the client so the report's totals
    // and the salary grid's cannot disagree — both are `signedGross`, summed.
    const byCreator = new Map<string, { gross: number; count: number }>();
    const byType = new Map<string, { gross: number; count: number }>();
    for (const sale of sales) {
      const creator = byCreator.get(sale.creatorName) ?? { gross: 0, count: 0 };
      creator.gross = round2(creator.gross + sale.signedGross);
      creator.count += 1;
      byCreator.set(sale.creatorName, creator);

      const type = byType.get(sale.type) ?? { gross: 0, count: 0 };
      type.gross = round2(type.gross + sale.signedGross);
      type.count += 1;
      byType.set(sale.type, type);
    }

    return NextResponse.json({
      month,
      day,
      sales,
      totals: {
        gross: sales.reduce((sum, s) => round2(sum + s.signedGross), 0),
        count: sales.length,
        reversals: sales.filter(s => s.status === 'reverse').length,
      },
      byCreator: [...byCreator.entries()]
        .map(([name, v]) => ({ name, ...v }))
        .sort((a, b) => b.gross - a.gross),
      byType: [...byType.entries()]
        .map(([name, v]) => ({ name, ...v }))
        .sort((a, b) => b.gross - a.gross),
    });
  } catch (err) {
    return handleApiError(err, 'ca-salary/sales GET');
  }
});

export const DELETE = withAuth(async (request: NextRequest, token: DecodedIdToken) => {
  try {
    const denied = await requireCaAdmin(token);
    if (denied) return denied;

    const saleId = new URL(request.url).searchParams.get('saleId');
    if (!saleId) return NextResponse.json({ error: 'saleId is required' }, { status: 400 });

    const snap = await adminDb.collection('ca-sales').doc(saleId).get();
    if (!snap.exists) return NextResponse.json({ error: 'Sale not found' }, { status: 404 });

    const sale = snap.data() as CaSaleDocument;
    if (await getFinalizedMonth(sale.userId, sale.month)) {
      return NextResponse.json(
        { error: 'This month is finalised. Reopen it before removing sales.' },
        { status: 409 },
      );
    }

    await deleteSale(saleId);
    return NextResponse.json({ success: true, month: sale.month, userId: sale.userId });
  } catch (err) {
    return handleApiError(err, 'ca-salary/sales DELETE');
  }
});
