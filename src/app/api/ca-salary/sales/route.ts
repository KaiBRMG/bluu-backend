/**
 * GET    /api/ca-salary/sales?month=YYYY-MM[&userId=uid][&day=YYYY-MM-DD]
 * GET    /api/ca-salary/sales?userId=all&from=YYYY-MM-DD&to=YYYY-MM-DD  — the admin ledger
 * DELETE /api/ca-salary/sales?saleId=…  — remove an Infloww history row (permanent; nothing re-imports it)
 *
 * The detailed sales report behind the agent's salary page and CA Admin →
 * Sales: every individual sale, so a disputed daily total can be traced to the
 * transaction that caused it.
 *
 * **Self-or-admin**, same as `/month` — an agent sees their own rows and nobody
 * else's. `userId=all` is the admin ledger (`ca-admin`): every row whose sale
 * falls between two salary days (`from`..`to`, inclusive, ≤ 93 days, newest
 * first — a `month` is still accepted and means that month), including rows
 * held by nobody (unassigned sales, unmapped chatters) and removed rows, and
 * every **anomaly** the ledger can detect (`flags` — see `getLedgerAnomalies`),
 * including sales held **off the shift schedule** (`schedule` — see
 * `scheduleMatch.ts`), and every sale a dispute claimed with what the claim did
 * to it (`disputes` — see `disputeLedger.ts`). A missing `userId` means "mine", never "everyone's".
 *
 * Every row says whether Bluu holds it where BuddyX credits it
 * (`matchesSource`) and, when not, why (`assignment`: a dispute or an admin).
 * The agent view lists the sales BuddyX credits to them that are held
 * elsewhere (`transferredAway`), so the two systems can be reconciled from
 * either side.
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
  getAllSalesInRange,
  getDepartures,
  getLedgerAnomalies,
  getScheduleMatches,
  getFinalizedMonth,
  getLeaveWindowsForMonth,
  getSalesForMonth,
  getTransferredAwaySales,
  getSalaryConfig,
  deleteSale,
} from '@/lib/services/caSalaryService';
import { displayNamesFor } from '@/lib/services/userService';
import { getSaleDisputeMarks } from '@/lib/services/disputeLedger';
import { addDays, addMonths, currentMonthKey, dayKeyRange, enumerateDays, isDayKey, isMonthKey, monthKeyRange } from '@/lib/salary/salaryDate';
import { SALARY_HISTORY_START_MONTH, SALES_CUTOVER_AT } from '@/lib/salary/salaryConstants';
import { round2 } from '@/lib/salary/salaryEngine';
import { leaveAt } from '@/lib/salary/leavePay';
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
    // rows the former historical import resolved); by name otherwise.
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

/** The widest window the admin ledger reads in one request — a quarter. */
const MAX_LEDGER_DAYS = 93;

/**
 * The admin ledger for a window of salary days. Every amount and flag is over
 * the whole window, so the client can page and filter without asking again —
 * one read of the window, not one per page (rule 9).
 */
async function adminLedger(searchParams: URLSearchParams): Promise<NextResponse> {
  const month = searchParams.get('month');
  let from = searchParams.get('from');
  let to = searchParams.get('to');
  if (month && !from && !to) {
    if (!isMonthKey(month)) return NextResponse.json({ error: 'month must be YYYY-MM' }, { status: 400 });
    from = `${month}-01`;
    to = addDays(`${addMonths(month, 1)}-01`, -1);
  }
  if (!isDayKey(from) || !isDayKey(to) || from > to) {
    return NextResponse.json({ error: 'from and to must be days (YYYY-MM-DD), from on or before to.' }, { status: 400 });
  }
  if (enumerateDays(from, to).length > MAX_LEDGER_DAYS) {
    return NextResponse.json({ error: `Pick at most ${MAX_LEDGER_DAYS} days at a time.` }, { status: 400 });
  }
  // Nothing before the salary history floor is shown anywhere (refuseHiddenMonth).
  const floor = `${SALARY_HISTORY_START_MONTH}-01`;
  if (to < floor) return NextResponse.json({ error: 'Salary history starts in September 2026.' }, { status: 400 });
  if (from < floor) from = floor;

  const [start] = dayKeyRange(from);
  const [, end] = dayKeyRange(to);
  const { deductionRate } = await getSalaryConfig();
  const rows = await getAllSalesInRange(start, end);
  const live = rows.filter(s => !s.removedAt);
  // Departed agents' leftover shifts are dropped, as the sync drops them — the
  // "On shift" column must never name someone who no longer works here.
  const schedule = await getScheduleMatches(live, start, end, await getDepartures());
  const [{ names, flags }, disputes] = await Promise.all([
    getLedgerAnomalies(rows, [...schedule.values()].flatMap(m => m.scheduled)),
    getSaleDisputeMarks(new Set(rows.map(s => s.saleId)), start),
  ]);
  // The Disputed view names filers too; most already hold a sale in the window.
  const missing = [...new Set(Object.values(disputes).map(d => d.filedBy))].filter(uid => uid && !names.has(uid));
  if (missing.length) for (const [uid, name] of await displayNamesFor(missing)) names.set(uid, name);

  // Unmapped-chatter rows are reported per chatter (the mapping lines), so
  // "unassigned" here means BuddyX assigned the sale to nobody.
  const unassigned = live.filter(s => !s.userId);
  const unassignedOf = (kind: 'tip' | 'ppv') => {
    const list = unassigned.filter(s => s.kind === kind && !s.unmappedChatterId);
    return { count: list.length, gross: list.reduce((sum, s) => round2(sum + s.signedGross), 0) };
  };
  const tips = unassignedOf('tip');
  const ppv = unassignedOf('ppv');
  const mismatched = live.filter(s => !s.matchesSource);
  return NextResponse.json(
    {
      from,
      to,
      view: 'all',
      sales: rows,
      names: Object.fromEntries(names),
      ...summarise(live, deductionRate),
      unassigned: {
        tips: tips.count,
        tipsGross: tips.gross,
        ppv: ppv.count,
        ppvGross: ppv.gross,
        unmapped: unassigned.filter(s => s.unmappedChatterId).length,
        claimed: unassigned.filter(s => s.disputeId).length,
      },
      mismatched: {
        dispute: mismatched.filter(s => s.assignment === 'dispute').length,
        admin: mismatched.filter(s => s.assignment === 'admin').length,
        gross: mismatched.reduce((sum, s) => round2(sum + s.signedGross), 0),
      },
      // Only the sales with someone scheduled on their account; absent = nobody was.
      schedule: Object.fromEntries(schedule),
      // Only the sales a dispute ever claimed — the latest claim and its outcome.
      disputes,
      flags: {
        attributionConflicts: rows.filter(s => s.attributionConflict && !s.removedAt).map(s => s.saleId),
        vanishedAfterFinalise: rows.filter(s => s.vanishedAfterFinalise).map(s => s.saleId),
        removed: rows.filter(s => s.removedAt).length,
        offSchedule: [...schedule].filter(([, m]) => m.differs).map(([id]) => id),
        ...flags,
      },
      spansCutover: start <= SALES_CUTOVER_AT && SALES_CUTOVER_AT < end,
    },
    { headers: NO_STORE },
  );
}

export const GET = withAuth(async (request: NextRequest, token: DecodedIdToken) => {
  try {
    const { searchParams } = new URL(request.url);

    // ── Admin: every row in a window ──
    if (searchParams.get('userId') === 'all') {
      const denied = await requireCaAdmin(token);
      if (denied) return denied;
      return adminLedger(searchParams);
    }

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

    // ── One agent ──
    const subject = await resolveSalarySubject(token, searchParams.get('userId'));
    if (subject instanceof NextResponse) return subject;

    const [all, away, finalized, leaveWindows] = await Promise.all([
      getSalesForMonth(subject.userId, month),
      getTransferredAwaySales(subject.userId, month),
      getFinalizedMonth(subject.userId, month),
      getLeaveWindowsForMonth(subject.userId, month),
    ]);
    // A sale inside an approved leave shift is listed but not paid — the same
    // rule the grid applies — so it is marked and left out of the totals below.
    const marked = leaveWindows.length === 0 ? all : all.map(s => {
      const leave = leaveAt(Date.parse(s.occurredAt), leaveWindows);
      return leave ? { ...s, duringLeave: leave.leaveType } : s;
    });
    const sales = day ? marked.filter(s => s.day === day) : marked;
    const counted = sales.filter(s => !s.duringLeave);
    const transferredAway = day ? away.filter(s => s.day === day) : away;

    // Names for "moved to X", "BuddyX credits Y" and "reassigned by Z" — one batched lookup.
    const names = await displayNamesFor([
      ...transferredAway.map(s => s.userId),
      ...sales.flatMap(s => [s.sourceUserId, s.transfer?.approvedBy ?? null]),
    ]);

    // "In": held on this agent, though BuddyX credits someone else (or nobody).
    // From the same (day-filtered) rows the tables show, so tile and tables agree.
    const inSales = counted.filter(s => !s.matchesSource);
    return NextResponse.json(
      {
        month,
        day,
        view: 'agent',
        sales,
        names: Object.fromEntries(names),
        ...summarise(counted, deductionRate),
        excludedForLeave: {
          count: sales.length - counted.length,
          gross: sales.filter(s => s.duringLeave).reduce((sum, s) => round2(sum + s.signedGross), 0),
        },
        transferredAway,
        transfers: {
          inGross: inSales.reduce((sum, s) => round2(sum + s.signedGross), 0),
          inCount: inSales.length,
          outGross: transferredAway.reduce((sum, s) => round2(sum + s.signedGross), 0),
          outCount: transferredAway.length,
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
