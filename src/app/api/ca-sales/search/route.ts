/**
 * GET /api/ca-sales/search?creatorId&from=YYYY-MM-DD&to=YYYY-MM-DD[&fanId]
 *
 * The tip search behind the New dispute dialog — the one place an agent sees
 * sales that are not their own, so it is deliberately narrow (D6):
 *
 * - **Tips only.** PPVs belong to their sender and never appear.
 * - **Scoped.** A creator is required, and the window is at most 7 days, inside
 *   the open months, after the cutover. There is no "show me everything".
 * - **No totals.** Each row names its holder (so the agent knows whom they are
 *   claiming from), but nothing sums a colleague's month.
 * - The caller's own tips and removed rows are left out.
 *
 * `ca-dashboard` page access — the same tier that may file. Served by the
 * `creatorId ASC, kind ASC, occurredAt ASC` composite index. Browser-cached
 * 30s (`private` + `Vary: Authorization`, rule 9i): a search re-run while the
 * agent flips between two creators should not re-read the same rows.
 */
import { NextRequest, NextResponse } from 'next/server';
import { Timestamp } from 'firebase-admin/firestore';
import { withAuth } from '@/lib/middleware/withAuth';
import { checkPageAccess, handleApiError } from '@/lib/middleware/apiHelpers';
import { adminDb } from '@/lib/firebase-admin';
import { addMonths, currentMonthKey, dayKeyRange, isDayKey } from '@/lib/salary/salaryDate';
import { SALES_CUTOVER_AT } from '@/lib/salary/salaryConstants';
import { getFinalizedMonthsFor } from '@/lib/services/caSalaryService';
import { displayNamesFor } from '@/lib/services/userService';
import type { CaSaleDocument } from '@/types/firestore';
import type { DecodedIdToken } from 'firebase-admin/auth';

const MAX_WINDOW_DAYS = 7;
/** A creator's busiest week is well under this; it bounds a hostile query. */
const MAX_ROWS = 500;

export interface SaleSearchRow {
  saleId: string;
  occurredAt: string;
  type: string;
  gross: number;
  fanId: string;
  fanName: string;
  holder: { uid: string; displayName: string } | null;
  /** An open dispute holds it. */
  disputed: boolean;
  /** Finalised for the holder or the caller — a claim could never be applied. */
  finalised: boolean;
}

export const GET = withAuth(async (request: NextRequest, token: DecodedIdToken) => {
  try {
    const denied = await checkPageAccess(token.uid, 'ca-dashboard');
    if (denied) return denied;

    const { searchParams } = new URL(request.url);
    const creatorId = searchParams.get('creatorId') ?? '';
    const from = searchParams.get('from') ?? '';
    const to = searchParams.get('to') ?? '';
    const fanId = (searchParams.get('fanId') ?? '').trim();

    if (!creatorId) return NextResponse.json({ error: 'Pick a creator.' }, { status: 400 });
    if (!isDayKey(from) || !isDayKey(to) || from > to) {
      return NextResponse.json({ error: 'from and to must be days, from ≤ to.' }, { status: 400 });
    }
    const [start] = dayKeyRange(from);
    const [, end] = dayKeyRange(to);
    if (end - start > MAX_WINDOW_DAYS * 86_400_000) {
      return NextResponse.json({ error: `Search at most ${MAX_WINDOW_DAYS} days at a time.` }, { status: 400 });
    }

    // Open months only: this month and last. Anything older is payroll history.
    const oldest = addMonths(currentMonthKey(), -1);
    if (from.slice(0, 7) < oldest) {
      return NextResponse.json({ error: 'Only the current and previous month can be disputed.' }, { status: 400 });
    }
    const queryStart = Math.max(start, SALES_CUTOVER_AT + 1);
    if (queryStart >= end) {
      return NextResponse.json({ rows: [], truncated: false }, { headers: { 'Cache-Control': 'private, max-age=30', Vary: 'Authorization' } });
    }

    const snap = await adminDb
      .collection('ca-sales')
      .where('creatorId', '==', creatorId)
      .where('kind', '==', 'tip')
      .where('occurredAt', '>=', Timestamp.fromMillis(queryStart))
      .where('occurredAt', '<', Timestamp.fromMillis(end))
      .orderBy('occurredAt', 'asc')
      .limit(MAX_ROWS + 1)
      .get();

    const docs = snap.docs
      .slice(0, MAX_ROWS)
      .map(d => d.data() as CaSaleDocument)
      .filter(s => !s.removedAt && s.userId !== token.uid && (!fanId || s.fanId === fanId));

    // Finalisation for every holder-month and the caller's own, in one read per month.
    const months = new Map<string, Set<string>>();
    for (const s of docs) {
      const set = months.get(s.month) ?? new Set<string>([token.uid]);
      if (s.userId) set.add(s.userId);
      months.set(s.month, set);
    }
    const finalized = new Set<string>();
    for (const [month, uids] of months) {
      for (const uid of await getFinalizedMonthsFor([...uids], month)) finalized.add(`${uid}|${month}`);
    }
    const names = await displayNamesFor(docs.map(s => s.userId));

    const rows: SaleSearchRow[] = docs.map(s => ({
      saleId: s.saleId,
      occurredAt: s.occurredAt?.toDate?.()?.toISOString() ?? '',
      type: s.type,
      gross: s.grossRevenue,
      fanId: s.fanId ?? '',
      fanName: s.fanName ?? '',
      holder: s.userId ? { uid: s.userId, displayName: names.get(s.userId) ?? '' } : null,
      disputed: Boolean(s.disputeId),
      finalised: finalized.has(`${token.uid}|${s.month}`) || (s.userId ? finalized.has(`${s.userId}|${s.month}`) : false),
    }));

    return NextResponse.json(
      { rows, truncated: snap.size > MAX_ROWS },
      { headers: { 'Cache-Control': 'private, max-age=30', Vary: 'Authorization' } },
    );
  } catch (err) {
    return handleApiError(err, 'ca-sales/search GET');
  }
});
