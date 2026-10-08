/**
 * GET    /api/ca-salary/sales?month=YYYY-MM[&userId=uid|all][&day=YYYY-MM-DD]
 * DELETE /api/ca-salary/sales?saleId=…  — remove an Infloww row a later export retracted
 *
 * The detailed sales report behind the agent's salary page and CA Admin →
 * Sales: every individual sale, so a disputed daily total can be traced to the
 * transaction that caused it.
 *
 * **Self-or-admin**, same as `/month` — an agent sees their own rows and nobody
 * else's. `userId=all` is the admin ledger (`ca-admin`): every agent's rows for
 * the month, plus the rows held by nobody (unassigned tips, unmapped chatters),
 * removed rows, and the flags the sync raised. A missing `userId` means "mine",
 * never "everyone's".
 *
 * Fan names are included because the agent is the person who talked to that
 * fan; they are the least surprising column on the page.
 *
 * **Uncached** (rule 9i): a sync or a dispute verdict changes it, and the
 * client reads it through its own 60s `queryCache`, which a write forces past.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { handleApiError } from '@/lib/middleware/apiHelpers';
import { requireCaAdmin, resolveSalarySubject, refuseHiddenMonth } from '@/lib/salary/salaryAuth';
import {
  getAllSalesForMonth,
  getFinalizedMonth,
  getSalesForMonth,
  getTransferredAwaySales,
  getSalaryConfig,
  deleteSale,
} from '@/lib/services/caSalaryService';
import { displayNamesFor } from '@/lib/services/userService';
import { currentMonthKey, isDayKey, isMonthKey, monthKeyRange } from '@/lib/salary/salaryDate';
import { SALES_CUTOVER_AT } from '@/lib/salary/salaryConstants';
import { round2 } from '@/lib/salary/salaryEngine';
import { adminDb } from '@/lib/firebase-admin';
import type { CaSaleDocument } from '@/types/firestore';
import type { SalarySale } from '@/lib/salary/salaryTypes';
import type { DecodedIdToken } from 'firebase-admin/auth';

const NO_STORE = { 'Cache-Control': 'private, no-store' };

interface Sum {
  gross: number;
  count: number;
}

function add(sum: Sum, gross: number): void {
  sum.gross = round2(sum.gross + gross);
  sum.count += 1;
}

/**
 * The summaries both views share, computed here rather than in the client so a
 * tile and the salary grid can never disagree — both are `signedGross`, summed.
 */
/**
 * Every amount on a sale is **gross** — what the fan paid. Net is what the
 * agency receives after OnlyFans' cut (`deductionRate`, 20%): the same
 * `gross × (1 − deductionRate)` the salary engine nets each day with, so the
 * report's net and the payslip's agree. BuddyX states the split too
 * (`net = gross × 0.8`); Infloww rows carry the export's own net column.
 */
function summarise(sales: SalarySale[], deductionRate: number) {
  const net = (gross: number) => round2(gross * (1 - deductionRate));
  const byKind = { tip: { gross: 0, count: 0 }, ppv: { gross: 0, count: 0 } };
  const byCreator = new Map<string, Sum & { creatorId: string | null; name: string }>();
  const byType = new Map<string, Sum>();
  const byDay = new Map<string, { day: string; tips: number; ppv: number }>();

  for (const sale of sales) {
    add(byKind[sale.kind], sale.signedGross);

    // Keyed by creator id where the row has one (every BuddyX row, and Infloww
    // rows the historical import resolved); by name otherwise.
    const key = sale.creatorId ?? `name:${sale.creatorName}`;
    const creator = byCreator.get(key) ?? { creatorId: sale.creatorId, name: sale.creatorName, gross: 0, count: 0 };
    add(creator, sale.signedGross);
    byCreator.set(key, creator);

    const type = byType.get(sale.type) ?? { gross: 0, count: 0 };
    add(type, sale.signedGross);
    byType.set(sale.type, type);

    const day = byDay.get(sale.day) ?? { day: sale.day, tips: 0, ppv: 0 };
    if (sale.kind === 'tip') day.tips = round2(day.tips + sale.signedGross);
    else day.ppv = round2(day.ppv + sale.signedGross);
    byDay.set(sale.day, day);
  }

  const gross = sales.reduce((sum, s) => round2(sum + s.signedGross), 0);
  return {
    deductionRate,
    totals: {
      gross,
      net: net(gross),
      count: sales.length,
      reversals: sales.filter(s => s.status === 'reverse').length,
    },
    byKind: {
      tip: { ...byKind.tip, net: net(byKind.tip.gross) },
      ppv: { ...byKind.ppv, net: net(byKind.ppv.gross) },
    },
    byCreator: [...byCreator.values()].sort((a, b) => b.gross - a.gross),
    byType: [...byType.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.gross - a.gross),
    byDay: [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day)),
  };
}

export const GET = withAuth(async (request: NextRequest, token: DecodedIdToken) => {
  try {
    const { searchParams } = new URL(request.url);
    const month = searchParams.get('month') ?? currentMonthKey();
    const day = searchParams.get('day');

    if (!isMonthKey(month)) {
      return NextResponse.json({ error: 'month must be YYYY-MM' }, { status: 400 });
    }
    const hidden = refuseHiddenMonth(month);
    if (hidden) return hidden;
    if (day !== null && !isDayKey(day)) {
      return NextResponse.json({ error: 'day must be YYYY-MM-DD' }, { status: 400 });
    }

    const { deductionRate } = await getSalaryConfig();
    const [monthStart, monthEnd] = monthKeyRange(month);
    const spansCutover = monthStart <= SALES_CUTOVER_AT && SALES_CUTOVER_AT < monthEnd;

    // ── Admin: every agent's rows ──
    if (searchParams.get('userId') === 'all') {
      const denied = await requireCaAdmin(token);
      if (denied) return denied;

      const all = await getAllSalesForMonth(month);
      const rows = day ? all.filter(s => s.day === day) : all;
      const live = rows.filter(s => !s.removedAt);
      const names = await displayNamesFor(rows.flatMap(s => [s.userId, s.transfer?.fromUserId ?? null]));

      const unassigned = live.filter(s => !s.userId);
      return NextResponse.json(
        {
          month,
          day,
          view: 'all',
          sales: rows,
          names: Object.fromEntries(names),
          ...summarise(live, deductionRate),
          unassigned: {
            tips: unassigned.filter(s => s.kind === 'tip' && !s.unmappedChatterId).length,
            tipsGross: unassigned
              .filter(s => s.kind === 'tip' && !s.unmappedChatterId)
              .reduce((sum, s) => round2(sum + s.signedGross), 0),
            unmapped: unassigned.filter(s => s.unmappedChatterId).length,
            claimed: unassigned.filter(s => s.disputeId).length,
          },
          flags: {
            attributionConflicts: rows.filter(s => s.attributionConflict).map(s => s.saleId),
            vanishedAfterFinalise: rows.filter(s => s.vanishedAfterFinalise).map(s => s.saleId),
            removed: rows.filter(s => s.removedAt).length,
          },
          spansCutover,
        },
        { headers: NO_STORE },
      );
    }

    // ── One agent ──
    const subject = await resolveSalarySubject(token, searchParams.get('userId'));
    if (subject instanceof NextResponse) return subject;

    const [all, away, finalized] = await Promise.all([
      getSalesForMonth(subject.userId, month),
      getTransferredAwaySales(subject.userId, month),
      getFinalizedMonth(subject.userId, month),
    ]);
    const sales = day ? all.filter(s => s.day === day) : all;
    const transferredAway = day ? away.filter(s => s.day === day) : away;

    // Names for "moved to X" and "moved from Y" — one batched lookup.
    const names = await displayNamesFor([
      ...transferredAway.map(s => s.userId),
      ...sales.map(s => s.transfer?.fromUserId ?? null),
    ]);

    const inSales = all.filter(s => s.transfer?.toUserId === subject.userId);
    return NextResponse.json(
      {
        month,
        day,
        view: 'agent',
        sales,
        names: Object.fromEntries(names),
        ...summarise(sales, deductionRate),
        transferredAway,
        transfers: {
          inGross: inSales.reduce((sum, s) => round2(sum + s.signedGross), 0),
          inCount: inSales.length,
          outGross: away.reduce((sum, s) => round2(sum + s.signedGross), 0),
          outCount: away.length,
        },
        finalized: Boolean(finalized),
        spansCutover,
      },
      { headers: NO_STORE },
    );
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

    // A BuddyX row would simply come back on the next sync. Removal there is
    // the sync's job (a row BuddyX stops returning is soft-removed); a row on
    // the wrong agent is a dispute, or an un-transfer.
    if (sale.source === 'buddyx') {
      return NextResponse.json(
        { error: 'BuddyX sales are synced and cannot be deleted here. Use a dispute to move one.' },
        { status: 409 },
      );
    }
    if (sale.userId && (await getFinalizedMonth(sale.userId, sale.month))) {
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
