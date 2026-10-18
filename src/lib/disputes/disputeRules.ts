/**
 * Disputes v2 — the decisions, with no Firestore in them.
 *
 * With BuddyX read-only, an approved dispute **moves the sale inside Bluu
 * Backend**: that makes these rules the money path, so they are pure and
 * tested (`tests/salary-engine/disputeTransfer.test.ts`). The service
 * (`disputeTransfer.ts`) reads, asks these, and writes.
 */
import { salesSourceFor } from '../salary/salaryConstants';

/** Most sales one submission may claim. */
export const MAX_DISPUTE_SALES = 50;

/** The holder sentinel for a sale nobody holds — the claim goes straight to admin. */
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

export type ClaimRefusal = 'not-found' | 'before-cutover' | 'removed' | 'yours' | 'disputed' | 'finalised';

/** The words a refusal shows on the row it applies to. */
export const CLAIM_REFUSAL_LABEL: Record<ClaimRefusal, string> = {
  'not-found': 'No longer exists',
  'before-cutover': 'Before the BuddyX cutover',
  removed: 'Removed from BuddyX',
  yours: 'Yours',
  disputed: 'Disputed',
  finalised: 'Finalised month',
};

/**
 * Why `filerUid` may not claim this sale, or `null` if they may.
 *
 * - **Tips and PPVs alike.** PPVs were refused while a fix still had to be made
 *   in BuddyX, which cannot reassign a PPV. Now that an approval moves the sale
 *   inside Bluu Backend, a PPV moves exactly as a tip does.
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
  if (salesSourceFor(sale.occurredAtMs) !== 'buddyx') return 'before-cutover';
  if (sale.removed) return 'removed';
  if (sale.userId === filerUid) return 'yours';
  if (sale.disputeId) return 'disputed';
  if (isFinalized(filerUid, sale.month) || (sale.userId && isFinalized(sale.userId, sale.month))) return 'finalised';
  return null;
}

/**
 * One submission → one dispute per current holder (D5). Unassigned sales group
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
 * moved is reported as moved, so approving twice is harmless — and so is one
 * the filer already holds (BuddyX re-credited it to them while the claim was
 * open): there is nothing left to move, only the lock to release.
 */
export function transferDecision(
  sale: (ClaimableSale & { transferDisputeId: string | null }) | null,
  dispute: { id: string; assignedTo: string; createdBy: string },
  isFinalized: (uid: string, month: string) => boolean,
): 'transfer' | 'already' | TransferSkip {
  if (!sale) return 'not-found';
  if (sale.transferDisputeId === dispute.id && sale.userId === dispute.createdBy) return 'already';
  if (sale.removed) return 'removed';
  if (sale.userId === dispute.createdBy) return 'already';
  if (sale.disputeId && sale.disputeId !== dispute.id) return 'locked';
  const expected = dispute.assignedTo === NO_ONE ? null : dispute.assignedTo;
  if (sale.userId !== expected) return 'holder-changed';
  if (isFinalized(dispute.createdBy, sale.month) || (expected && isFinalized(expected, sale.month))) return 'finalised';
  return 'transfer';
}

// ─── Admin reassignment ──────────────────────────────────────────────

/**
 * A dispute lock is stale once its dispute can no longer move the sale —
 * decided by an admin, declined by the holder, or gone. Such a lock blocks a
 * fresh claim and admin reassignment for no reason, so CA Admin → Sales flags
 * it and a reassignment clears it.
 */
export function lockIsStale(dispute: { exists: boolean; get(field: string): unknown }): boolean {
  if (!dispute.exists) return true;
  const admin = dispute.get('AdminApproval');
  return admin === 'Approved' || admin === 'Rejected' || dispute.get('CaApproval') === 'Rejected';
}

export type ReassignRefusal = 'not-found' | 'removed' | 'disputed' | 'same' | 'finalised';

export const REASSIGN_REFUSAL: Record<ReassignRefusal, { status: number; message: string }> = {
  'not-found': { status: 404, message: 'Sale not found.' },
  removed: { status: 409, message: 'This sale is no longer in BuddyX, so it counts toward nobody.' },
  disputed: { status: 409, message: 'An open dispute holds this sale. Rule on the dispute first.' },
  same: { status: 409, message: 'The sale is already held there.' },
  finalised: { status: 409, message: 'This month is finalised for one of the agents. Reopen it first.' },
};

/**
 * Whether an admin may move this sale to `toUserId` (`null` = nobody) — or why
 * not. Pure; `reassignSale` re-runs it inside its transaction.
 *
 * Any sale — BuddyX or Infloww history — is an ordinary `ca-sales` row and
 * moves the same way. A sale an *open* dispute holds (pass `disputeId: null`
 * for a stale lock — `lockIsStale`) must be ruled on first —
 * moving it underneath the claim would leave the verdict acting on a sale that
 * is no longer where the claim says. Finalised for the current holder **or**
 * the new one is refused, because either way a paid month would move.
 */
export function reassignRefusal(
  sale: {
    userId: string | null;
    sourceUserId: string | null;
    hasTransfer: boolean;
    removed: boolean;
    disputeId: string | null;
    month: string;
  } | null,
  toUserId: string | null,
  isFinalized: (uid: string, month: string) => boolean,
): ReassignRefusal | null {
  if (!sale) return 'not-found';
  if (sale.removed) return 'removed';
  if (sale.disputeId) return 'disputed';
  // Moving a sale back onto BuddyX's attribution is never "the same" while a
  // transfer is on it — that is how a transfer BuddyX has since agreed with is cleared.
  if (sale.userId === toUserId && !(sale.hasTransfer && toUserId === sale.sourceUserId)) return 'same';
  if ((sale.userId && isFinalized(sale.userId, sale.month)) || (toUserId && isFinalized(toUserId, sale.month))) {
    return 'finalised';
  }
  return null;
}
