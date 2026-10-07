/**
 * Disputes v2 — the decisions, with no Firestore in them.
 *
 * With BuddyX read-only, an approved dispute **moves the sale inside Bluu
 * Backend**: that makes these rules the money path, so they are pure and
 * tested (`tests/salary-engine/disputeTransfer.test.ts`). The service
 * (`disputeTransfer.ts`) reads, asks these, and writes.
 */
import { salesSourceFor } from '../salary/salaryConstants';

/** Most tips one submission may claim. */
export const MAX_DISPUTE_SALES = 50;

/** The holder sentinel for a tip nobody holds — the claim goes straight to admin. */
export const NO_ONE = 'No One';

/** What the claim and approval rules need to know about a sale. */
export interface ClaimableSale {
  saleId: string;
  kind: 'tip' | 'ppv';
  occurredAtMs: number;
  month: string;
  userId: string | null;
  removed: boolean;
  disputeId: string | null;
}

export type ClaimRefusal = 'not-found' | 'ppv' | 'before-cutover' | 'removed' | 'yours' | 'disputed' | 'finalised';

/** The words a refusal shows on the row it applies to. */
export const CLAIM_REFUSAL_LABEL: Record<ClaimRefusal, string> = {
  'not-found': 'No longer exists',
  ppv: 'PPV sales are assigned to the sender',
  'before-cutover': 'Before the BuddyX cutover',
  removed: 'Removed from BuddyX',
  yours: 'Yours',
  disputed: 'Disputed',
  finalised: 'Finalised month',
};

/**
 * Why `filerUid` may not claim this sale, or `null` if they may.
 *
 * - **Tips only.** A PPV is assigned to whoever sent it, which is not something
 *   a dispute can be right about.
 * - **After the cutover only.** Infloww history was settled in the CRM.
 * - **Not removed, not already the filer's, not held by another open dispute.**
 * - **Not in a finalised month** for the holder *or* the filer — a transfer
 *   could never be applied there, so the claim is refused up front.
 */
export function claimRefusal(
  sale: ClaimableSale | null,
  filerUid: string,
  isFinalized: (uid: string, month: string) => boolean,
): ClaimRefusal | null {
  if (!sale) return 'not-found';
  if (sale.kind !== 'tip') return 'ppv';
  if (salesSourceFor(sale.occurredAtMs) !== 'buddyx') return 'before-cutover';
  if (sale.removed) return 'removed';
  if (sale.userId === filerUid) return 'yours';
  if (sale.disputeId) return 'disputed';
  if (isFinalized(filerUid, sale.month) || (sale.userId && isFinalized(sale.userId, sale.month))) return 'finalised';
  return null;
}

/**
 * One submission → one dispute per current holder (D5). Unassigned tips group
 * under `No One`, which has no holder to approve, so that dispute goes straight
 * to admin. Groups come out in a stable order: named holders by uid, `No One` last.
 */
export function groupByHolder<T extends { userId: string | null }>(sales: T[]): Array<{ holder: string; sales: T[] }> {
  const groups = new Map<string, T[]>();
  for (const sale of sales) {
    const holder = sale.userId ?? NO_ONE;
    const list = groups.get(holder) ?? [];
    list.push(sale);
    groups.set(holder, list);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a === NO_ONE ? 1 : b === NO_ONE ? -1 : a.localeCompare(b)))
    .map(([holder, list]) => ({ holder, sales: list }));
}

export type TransferSkip = 'not-found' | 'removed' | 'holder-changed' | 'finalised' | 'locked';

export const TRANSFER_SKIP_LABEL: Record<TransferSkip, string> = {
  'not-found': 'no longer exists',
  removed: 'removed from BuddyX',
  'holder-changed': 'no longer held by the agent it was claimed from',
  finalised: 'month finalised',
  locked: 'held by another dispute',
};

/**
 * Whether an admin approval may move this sale to the filer — or why not.
 *
 * Re-checked at approval time, inside the transaction, because the claim was
 * filed minutes or days earlier: the sale must still be held by the agent it
 * was claimed from (or still be unassigned, for a `No One` claim), and the
 * month must still be open for both parties. A sale this same dispute already
 * moved is reported as moved, so approving twice is harmless.
 */
export function transferDecision(
  sale: (ClaimableSale & { transferDisputeId: string | null }) | null,
  dispute: { id: string; assignedTo: string; createdBy: string },
  isFinalized: (uid: string, month: string) => boolean,
): 'transfer' | 'already' | TransferSkip {
  if (!sale) return 'not-found';
  if (sale.transferDisputeId === dispute.id && sale.userId === dispute.createdBy) return 'already';
  if (sale.removed) return 'removed';
  if (sale.disputeId && sale.disputeId !== dispute.id) return 'locked';
  const expected = dispute.assignedTo === NO_ONE ? null : dispute.assignedTo;
  if (sale.userId !== expected) return 'holder-changed';
  if (isFinalized(dispute.createdBy, sale.month) || (expected && isFinalized(expected, sale.month))) return 'finalised';
  return 'transfer';
}
