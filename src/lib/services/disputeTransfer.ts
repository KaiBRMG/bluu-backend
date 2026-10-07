/**
 * Disputes v2 — filing, verdicts and un-transfers, against `ca-sales`.
 *
 * Before BuddyX, an approved dispute changed nothing in Bluu Backend: an admin
 * fixed the CRM and the fix came back in the next export. BuddyX is read-only,
 * so **an admin approval now transfers the sale here**, and Bluu Backend becomes
 * the source of truth for who holds it (documentation/buddyx.md §4):
 *
 * - A sale's effective holder is `transfer?.toUserId ?? sourceUserId`, and
 *   `userId` always equals it — so every pay path follows the transfer with no
 *   change of its own.
 * - A sync never clears a transfer (`salesPlan.ts`); a BuddyX re-attribution
 *   after one is flagged for an admin, never applied.
 * - A transfer never touches a finalised month, so "what we paid" never moves.
 *
 * The decisions are pure (`lib/disputes/disputeRules.ts`); this file runs them
 * inside transactions. Every route that rules on a dispute — the single admin
 * verdict, the bulk bar, the CA verdict — goes through here, so there is one
 * implementation of "what approving does".
 */
import 'server-only';
import { FieldValue, Timestamp, type DocumentReference, type Transaction } from 'firebase-admin/firestore';
import { adminDb } from '../firebase-admin';
import {
  claimRefusal,
  groupByHolder,
  NO_ONE,
  transferDecision,
  TRANSFER_SKIP_LABEL,
  type ClaimableSale,
  type ClaimRefusal,
} from '../disputes/disputeRules';
import { notifications } from '../notificationContent';
import { saleKindOf } from '../salary/saleTypes';
import { notifyUsers } from './caNotifications';
import { getUserById } from './userService';
import type { CaSaleDocument } from '@/types/firestore';

const SALES = 'ca-sales';
const DISPUTES = 'disputes';
const MONTHS = 'ca-salary-months';

type SaleSnapshot = { ref: DocumentReference; data: CaSaleDocument | null };

function claimable(data: CaSaleDocument | null, id: string): (ClaimableSale & { transferDisputeId: string | null }) | null {
  if (!data) return null;
  return {
    saleId: id,
    kind: saleKindOf(data),
    occurredAtMs: data.occurredAt?.toMillis?.() ?? 0,
    month: data.month,
    userId: data.userId ?? null,
    removed: Boolean(data.removedAt),
    disputeId: data.disputeId ?? null,
    transferDisputeId: data.transfer?.disputeId ?? null,
  };
}

/**
 * Read which `uid|month` pairs are finalised, inside a transaction. A
 * transaction's reads must precede its writes, so callers collect every pair
 * they might need first.
 */
async function finalizedIn(tx: Transaction, pairs: Set<string>): Promise<Set<string>> {
  const list = [...pairs];
  if (list.length === 0) return new Set();
  const refs = list.map(p => {
    const [uid, month] = p.split('|');
    return adminDb.collection(MONTHS).doc(`${uid}_${month}`);
  });
  const snaps = await tx.getAll(...refs);
  const out = new Set<string>();
  snaps.forEach((snap, i) => {
    if (snap.exists && snap.get('status') === 'finalized') out.add(list[i]);
  });
  return out;
}

// ─── Filing ──────────────────────────────────────────────────────────

export interface FiledDispute {
  disputeId: string;
  assignedTo: string;
  count: number;
  gross: number;
}

export type FileOutcome =
  | { ok: true; groupId: string; disputes: FiledDispute[] }
  | { ok: false; refused: Array<{ saleId: string; reason: ClaimRefusal }> };

/**
 * File one claim over up to 50 tips. All-or-nothing: if any tip cannot be
 * claimed (it was locked by someone else a moment ago, say) nothing is written
 * and every refusal is returned, so the dialog can mark those rows and keep
 * the rest of the claim.
 *
 * On success: one dispute per current holder sharing a `groupId`, and every
 * claimed sale locked with its dispute's id. The holders are told after the
 * commit (`disputeAssigned`); an unassigned group notifies nobody — it goes
 * straight to admin.
 */
export async function fileDisputes(params: { filerUid: string; saleIds: string[]; comment: string }): Promise<FileOutcome> {
  const { filerUid, comment } = params;
  const saleIds = [...new Set(params.saleIds)];
  const groupId = adminDb.collection(DISPUTES).doc().id;

  const outcome = await adminDb.runTransaction(async tx => {
    const refs = saleIds.map(id => adminDb.collection(SALES).doc(id));
    const snaps = await tx.getAll(...refs);
    const sales: SaleSnapshot[] = snaps.map((snap, i) => ({
      ref: refs[i],
      data: snap.exists ? (snap.data() as CaSaleDocument) : null,
    }));

    const pairs = new Set<string>();
    for (const { data } of sales) {
      if (!data) continue;
      pairs.add(`${filerUid}|${data.month}`);
      if (data.userId) pairs.add(`${data.userId}|${data.month}`);
    }
    const finalized = await finalizedIn(tx, pairs);
    const isFinalized = (uid: string, month: string) => finalized.has(`${uid}|${month}`);

    const refused: Array<{ saleId: string; reason: ClaimRefusal }> = [];
    for (const { ref, data } of sales) {
      const reason = claimRefusal(claimable(data, ref.id), filerUid, isFinalized);
      if (reason) refused.push({ saleId: ref.id, reason });
    }
    if (refused.length > 0) return { ok: false as const, refused };

    const live = sales.map(s => ({ ref: s.ref, data: s.data!, userId: s.data!.userId ?? null }));
    const filed: FiledDispute[] = [];
    const groups = groupByHolder(live);
    for (const group of groups) {
      const disputeRef = adminDb.collection(DISPUTES).doc();
      const snapshot = group.sales
        .map(({ ref, data }) => ({
          saleId: ref.id,
          occurredAt: data.occurredAt,
          creatorId: data.creatorId ?? null,
          creatorName: data.creatorName ?? '',
          fanId: data.fanId ?? '',
          fanName: data.fanName ?? '',
          type: data.type ?? 'tips',
          gross: data.grossRevenue,
        }))
        .sort((a, b) => a.occurredAt.toMillis() - b.occurredAt.toMillis());
      const totalGross = Math.round(snapshot.reduce((sum, s) => sum + s.gross, 0) * 100) / 100;
      const creators = [...new Set(snapshot.map(s => s.creatorId ?? s.creatorName))];
      const fans = [...new Set(snapshot.map(s => s.fanId))];

      tx.set(disputeRef, {
        version: 2,
        groupId,
        // How many disputes this submission became — "Filed with 1 other
        // dispute" — stored rather than queried, since `groupId` is index-exempt.
        groupSize: groups.length,
        saleIds: snapshot.map(s => s.saleId),
        sales: snapshot,
        totalGross,
        createdBy: filerUid,
        assignedTo: group.holder,
        // Legacy mirrors: every existing dispute surface reads these, so a v2
        // dispute renders everywhere a v1 one does without a second code path.
        Creator: creators.length === 1 ? creators[0] : 'multiple',
        saleDate: snapshot[0].occurredAt,
        saleAmount: totalGross,
        fanName: fans.length === 1 ? snapshot[0].fanName || snapshot[0].fanId : `${fans.length} fans`,
        Comment: comment,
        CaApproval: 'Pending',
        AdminApproval: 'Pending',
        createdAt: FieldValue.serverTimestamp(),
      });
      for (const { ref } of group.sales) tx.update(ref, { disputeId: disputeRef.id });
      filed.push({ disputeId: disputeRef.id, assignedTo: group.holder, count: snapshot.length, gross: totalGross });
    }
    return { ok: true as const, groupId, disputes: filed };
  });

  if (outcome.ok) {
    const holders = outcome.disputes.map(d => d.assignedTo).filter(h => h !== NO_ONE);
    if (holders.length > 0) {
      const filer = await getUserById(filerUid);
      await notifyUsers(holders, notifications.disputeAssigned(filer?.displayName ?? 'Someone'), { label: 'disputeAssigned' });
    }
  }
  return outcome;
}

// ─── Verdicts ────────────────────────────────────────────────────────

export interface TransferResult {
  transferred: string[];
  skipped: Array<{ saleId: string; reason: string }>;
}

export interface VerdictOutcome {
  found: boolean;
  version: 1 | 2;
  createdBy: string | null;
  transferResult: TransferResult | null;
  /**
   * `uid|month` pairs whose gross moved. The caller hands them to
   * `announceTierCrossings` from `after()`, so a verdict never waits on a month
   * recomputation — and a bulk verdict recomputes once, not once per dispute.
   */
  touched: string[];
}

/**
 * The admin's verdict on one dispute. Shared by the single route and the bulk
 * bar (which is a loop over this).
 *
 * - **v1 (legacy):** sets the verdict and moves nothing — those disputes were
 *   adjusted by hand in the CRM, and the detail dialog says so.
 * - **v2, Approved:** each sale still held as claimed, in a month open for both
 *   parties, is transferred to the filer; the rest are skipped with a reason.
 *   **Partial success is recorded in `transferResult`, never thrown.**
 * - **v2, Rejected:** the sales are released for a fresh claim. A dispute that
 *   had been *approved* and is now rejected (the Resolved tab can flip a
 *   verdict) also gives its transfers back, where the month is still open —
 *   otherwise the status would say "rejected" while the money said otherwise.
 */
export async function applyAdminVerdict(params: {
  disputeId: string;
  verdict: 'Approved' | 'Rejected';
  actorUid: string;
}): Promise<VerdictOutcome> {
  const { disputeId, verdict, actorUid } = params;
  const disputeRef = adminDb.collection(DISPUTES).doc(disputeId);

  const outcome = await adminDb.runTransaction(async (tx): Promise<VerdictOutcome> => {
    const disputeSnap = await tx.get(disputeRef);
    if (!disputeSnap.exists) return { found: false, version: 1, createdBy: null, transferResult: null, touched: [] };
    const dispute = disputeSnap.data()!;
    const createdBy = String(dispute.createdBy ?? '');

    if (dispute.version !== 2) {
      tx.update(disputeRef, { AdminApproval: verdict, resolvedAt: FieldValue.serverTimestamp() });
      return { found: true, version: 1, createdBy, transferResult: null, touched: [] };
    }

    const saleIds: string[] = Array.isArray(dispute.saleIds) ? dispute.saleIds : [];
    const refs = saleIds.map(id => adminDb.collection(SALES).doc(id));
    const snaps = refs.length ? await tx.getAll(...refs) : [];
    const sales = snaps.map((snap, i) => ({ ref: refs[i], data: snap.exists ? (snap.data() as CaSaleDocument) : null }));

    const pairs = new Set<string>();
    for (const { data } of sales) {
      if (!data) continue;
      pairs.add(`${createdBy}|${data.month}`);
      if (data.userId) pairs.add(`${data.userId}|${data.month}`);
      if (data.transfer?.fromUserId) pairs.add(`${data.transfer.fromUserId}|${data.month}`);
    }
    const finalized = await finalizedIn(tx, pairs);
    const isFinalized = (uid: string, month: string) => finalized.has(`${uid}|${month}`);
    const touched = new Set<string>();

    if (verdict === 'Approved') {
      const result: TransferResult = { transferred: [], skipped: [] };
      for (const { ref, data } of sales) {
        const decision = transferDecision(
          claimable(data, ref.id),
          { id: disputeId, assignedTo: String(dispute.assignedTo), createdBy },
          isFinalized,
        );
        if (decision === 'already') {
          result.transferred.push(ref.id);
          continue;
        }
        if (decision !== 'transfer') {
          result.skipped.push({ saleId: ref.id, reason: TRANSFER_SKIP_LABEL[decision] });
          // Release a lock this dispute holds even when the sale cannot move.
          if (data?.disputeId === disputeId) tx.update(ref, { disputeId: null });
          continue;
        }
        const from = data!.userId ?? null;
        tx.update(ref, {
          transfer: {
            fromUserId: from,
            toUserId: createdBy,
            disputeId,
            approvedBy: actorUid,
            approvedAt: Timestamp.now(),
          },
          transferFromUserId: from,
          userId: createdBy,
          disputeId: null,
        });
        result.transferred.push(ref.id);
        touched.add(`${createdBy}|${data!.month}`);
        if (from) touched.add(`${from}|${data!.month}`);
      }
      tx.update(disputeRef, { AdminApproval: verdict, resolvedAt: FieldValue.serverTimestamp(), transferResult: result });
      return { found: true, version: 2, createdBy, transferResult: result, touched: [...touched] };
    }

    // Rejected: release the locks; give back any transfer this dispute made.
    for (const { ref, data } of sales) {
      if (!data) continue;
      if (data.transfer?.disputeId === disputeId) {
        const from = data.transfer.fromUserId ?? null;
        if (isFinalized(createdBy, data.month) || (from && isFinalized(from, data.month))) continue;
        tx.update(ref, {
          transfer: null,
          transferFromUserId: null,
          userId: data.sourceUserId ?? null,
          disputeId: null,
        });
        touched.add(`${createdBy}|${data.month}`);
        if (data.sourceUserId) touched.add(`${data.sourceUserId}|${data.month}`);
      } else if (data.disputeId === disputeId) {
        tx.update(ref, { disputeId: null });
      }
    }
    tx.update(disputeRef, { AdminApproval: verdict, resolvedAt: FieldValue.serverTimestamp() });
    return { found: true, version: 2, createdBy, transferResult: null, touched: [...touched] };
  });

  return outcome;
}

/**
 * Release a v2 dispute's locks without a transfer — a CA (the holder)
 * rejecting the claim. The sales become disputable again. A no-op for v1.
 */
export async function releaseDisputeLocks(disputeId: string): Promise<void> {
  const snap = await adminDb.collection(DISPUTES).doc(disputeId).get();
  if (!snap.exists || snap.get('version') !== 2) return;
  const saleIds: string[] = snap.get('saleIds') ?? [];
  if (saleIds.length === 0) return;
  await adminDb.runTransaction(async tx => {
    const snaps = await tx.getAll(...saleIds.map(id => adminDb.collection(SALES).doc(id)));
    for (const sale of snaps) {
      if (sale.exists && sale.get('disputeId') === disputeId) tx.update(sale.ref, { disputeId: null });
    }
  });
}

// ─── Un-transfer ─────────────────────────────────────────────────────

export type UntransferOutcome =
  | { ok: true; disputeId: string; touched: string[] }
  | { ok: false; status: number; error: string };

/**
 * Revert one transfer — the escape hatch for a wrong approval, which no longer
 * has a CRM to undo it in. Open months only, for both parties. The sale goes
 * back to whoever the source attributes it to *now*, and the dispute records
 * who reverted it, when and why.
 */
export async function untransferSale(params: { saleId: string; actorUid: string; reason: string }): Promise<UntransferOutcome> {
  const { saleId, actorUid, reason } = params;
  const ref = adminDb.collection(SALES).doc(saleId);

  const outcome = await adminDb.runTransaction(async (tx): Promise<UntransferOutcome> => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { ok: false, status: 404, error: 'Sale not found' };
    const sale = snap.data() as CaSaleDocument;
    if (!sale.transfer) return { ok: false, status: 409, error: 'This sale has not been transferred.' };

    const to = sale.transfer.toUserId;
    const back = sale.sourceUserId ?? null;
    const pairs = new Set([`${to}|${sale.month}`]);
    if (back) pairs.add(`${back}|${sale.month}`);
    const finalized = await finalizedIn(tx, pairs);
    if (finalized.size > 0) {
      return { ok: false, status: 409, error: 'This month is finalised for one of the agents. Reopen it first.' };
    }

    const disputeId = sale.transfer.disputeId;
    tx.update(ref, { transfer: null, transferFromUserId: null, userId: back, disputeId: null });
    tx.set(
      adminDb.collection(DISPUTES).doc(disputeId),
      { untransfers: FieldValue.arrayUnion({ saleId, by: actorUid, at: Timestamp.now(), reason }) },
      { merge: true },
    );
    const touched = [`${to}|${sale.month}`];
    if (back) touched.push(`${back}|${sale.month}`);
    return { ok: true, disputeId, touched };
  });

  return outcome;
}
