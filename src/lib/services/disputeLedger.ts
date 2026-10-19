/**
 * Disputes joined onto CA Admin → Sales — the ledger's **Disputed** view.
 *
 * Disputes used to have their own admin tab. They are a fact *about sales*, so
 * since 2026-10-19 they live on the sales ledger: every sale a dispute claimed
 * carries a `SaleDisputeMark` — the latest claim on it and what that claim did
 * to this sale (`saleDisputeOutcome`). Opening the claim itself is a separate,
 * on-demand read (`GET /api/disputes/[id]`).
 *
 * ## Why from `disputes`, not from the sale
 *
 * A sale only remembers an *open* claim (`disputeId`, the lock) and a claim
 * that *moved* it (`transfer`). A declined or rejected claim clears the lock and
 * leaves no trace on the row — and "which disputes were turned down" is half of
 * what this view is for. So the claims are read from `disputes` and matched by
 * `saleIds`.
 *
 * ## Read budget (rule 9)
 *
 * A sale cannot be disputed before it happened, so every claim on a sale in the
 * window was **filed on or after the window's start**: one range query on
 * `createdAt` (a single-field index), field-masked to what the outcome needs.
 * Its upper bound is "now" rather than the window's end, because a claim may be
 * filed days after the sale — the scan grows with how far back the window
 * starts, and is bounded by the ledger's 93-day ceiling.
 */
import 'server-only';
import { Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '../firebase-admin';
import { NO_ONE, saleDisputeOutcome, type SaleDisputeMark } from '../disputes/disputeRules';

const FIELDS = [
  'saleIds',
  'createdAt',
  'createdBy',
  'assignedTo',
  'CaApproval',
  'AdminApproval',
  'overturnedAt',
  'transferResult',
  'untransfers',
];

export async function getSaleDisputeMarks(saleIds: Set<string>, startMs: number): Promise<Record<string, SaleDisputeMark>> {
  if (saleIds.size === 0) return {};
  const snap = await adminDb
    .collection('disputes')
    .where('createdAt', '>=', Timestamp.fromMillis(startMs))
    .select(...FIELDS)
    .get();

  // Oldest first, so the last claim written for a sale is its latest.
  const docs = snap.docs
    .map(d => ({ id: d.id, data: d.data() }))
    .sort((a, b) => (a.data.createdAt?.toMillis?.() ?? 0) - (b.data.createdAt?.toMillis?.() ?? 0));

  const marks: Record<string, SaleDisputeMark> = {};
  for (const { id, data } of docs) {
    const ids: string[] = Array.isArray(data.saleIds) ? data.saleIds : [];
    const claimed = ids.filter(saleId => saleIds.has(saleId));
    if (claimed.length === 0) continue;

    const input = {
      CaApproval: String(data.CaApproval ?? 'Pending'),
      AdminApproval: String(data.AdminApproval ?? 'Pending'),
      overturned: Boolean(data.overturnedAt),
      transferred: data.transferResult?.transferred ?? [],
      skipped: data.transferResult?.skipped ?? [],
      untransferred: Array.isArray(data.untransfers) ? data.untransfers.map((u: { saleId?: string }) => String(u.saleId ?? '')) : [],
    };
    for (const saleId of claimed) {
      const { outcome, skipReason } = saleDisputeOutcome(input, saleId);
      marks[saleId] = {
        disputeId: id,
        outcome,
        skipReason,
        filedBy: String(data.createdBy ?? ''),
        claimedFrom: data.assignedTo && data.assignedTo !== NO_ONE ? String(data.assignedTo) : null,
        filedAt: data.createdAt?.toDate?.().toISOString() ?? null,
        earlier: marks[saleId] ? marks[saleId].earlier + 1 : 0,
      };
    }
  }
  return marks;
}
