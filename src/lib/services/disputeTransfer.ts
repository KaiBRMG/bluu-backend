/**
 * Who holds a sale — disputes v2 (filing, verdicts, un-transfers) and admin
 * reassignment from CA Admin → Sales, against `ca-sales`.
 *
 * Before BuddyX, an approved dispute changed nothing in Bluu Backend: an admin
 * fixed the CRM and the fix came back in the next export. BuddyX is read-only,
 * so **an approval now transfers the sale here** — since 2026-10-19 the
 * holder's, which is the only approval a dispute needs — and Bluu Backend is the
 * source of truth for who holds it (documentation/buddyx.md §5):
 *
 * - A sale's effective holder is `transfer?.toUserId ?? sourceUserId`, and
 *   `userId` always equals it — so every pay path follows the transfer with no
 *   change of its own.
 * - A sync never clears a transfer (`salesPlan.ts`); a BuddyX re-attribution
 *   after one is flagged for an admin, never applied.
 * - An admin may also move a sale directly (`reassignSale`) — the same
 *   `transfer` field with `kind: 'admin'` and a required reason, so it survives
 *   a sync exactly as a dispute's move does.
 * - Every change of holder appends to the sale's `assignmentLog`.
 * - A transfer never touches a finalised month, so "what we paid" never moves.
 *
 * The decisions are pure (`lib/disputes/disputeRules.ts`); this file runs them
 * inside transactions. Both routes that rule on a dispute — the holder's verdict
 * and the admin's — go through `applyVerdict`, so there is one implementation
 * of "what approving does".
 */
import 'server-only';
import { FieldValue, Timestamp, type DocumentReference, type Transaction } from 'firebase-admin/firestore';
import { adminDb } from '../firebase-admin';
import {
  claimRefusal,
  groupByHolder,
  lockIsStale,
  NO_ONE,
  reassignRefusal,
  REASSIGN_REFUSAL,
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

type AssignmentLogEntry = NonNullable<CaSaleDocument['assignmentLog']>[number];

function logEntry(entry: Omit<AssignmentLogEntry, 'at'>): FieldValue {
  return FieldValue.arrayUnion({ ...entry, at: Timestamp.now() });
}

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
 * File one claim over up to 50 sales. All-or-nothing: if any sale cannot be
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

interface VerdictOutcome {
  found: boolean;
  /**
   * Nothing was written. `decided` / `not-assigned`: the dispute was not open
   * to this holder (only a CA verdict returns these — an admin may rule on any
   * dispute). `reason-required`: an admin overturn with no reason.
   */
  conflict?: 'decided' | 'not-assigned' | 'reason-required';
  version: 1 | 2;
  createdBy: string | null;
  transferResult: TransferResult | null;
  /**
   * `uid|month` pairs whose gross moved. The caller hands them to
   * `announceTierCrossings` from `after()`, so a verdict never waits on a month
   * recomputation.
   */
  touched: string[];
}

/** Who is ruling: the agent who holds the claimed sales, or a CA admin. */
type VerdictVia = 'ca' | 'admin';

/**
 * A verdict on one dispute — the one implementation of "what approving does".
 *
 * **There is one approval, not two.** Since 2026-10-19 the agent who holds the
 * claimed sales (`assignedTo`) is the only approval a dispute needs: their
 * Approve moves the sales, in this transaction. An admin rules only where no
 * holder exists (`No One` — BuddyX credits the sale to nobody, or to a chatter
 * not mapped yet), may rule in a holder's place, and may overturn.
 *
 * `AdminApproval` is therefore the **final verdict**, whoever gave it: a CA
 * approval writes `AdminApproval: 'Approved'` too, and `approvedVia: 'ca'` says
 * who actually decided. Every reader that asks "is this decided?" —
 * `lockIsStale`, the filer's summary, the salary lock read, the list filters —
 * keeps working unchanged because of that.
 *
 * - **CA (`via: 'ca'`):** only the holder, only while both approvals are
 *   `Pending` — re-checked inside the transaction, since this moves money.
 *   Rejected releases the locks and is terminal for the filer.
 * - **v1 (legacy):** sets the verdict and moves nothing — those disputes were
 *   adjusted by hand in the CRM, and the detail dialog says so.
 * - **v2, Approved:** each sale still held as claimed, in a month open for both
 *   parties, is transferred to the filer; the rest are skipped with a reason.
 *   **Partial success is recorded in `transferResult`, never thrown.** Stamps
 *   `approvedAt`, which CA Admin → Sales' "Moved by dispute" feed orders on.
 * - **Admin, Rejected:** the sales are released for a fresh claim. An approved
 *   dispute is **overturned**: its transfers go back where the month is still
 *   open, and who and why is recorded on it — otherwise the status would say
 *   "rejected" while the money said otherwise.
 */
export async function applyVerdict(params: {
  disputeId: string;
  verdict: 'Approved' | 'Rejected';
  actorUid: string;
  via: VerdictVia;
  /** Recorded on an overturn, which refuses to run without one (≥ 3 chars). */
  reason?: string;
}): Promise<VerdictOutcome> {
  const { disputeId, verdict, actorUid, via } = params;
  const reason = params.reason?.trim() || null;
  const disputeRef = adminDb.collection(DISPUTES).doc(disputeId);

  const outcome = await adminDb.runTransaction(async (tx): Promise<VerdictOutcome> => {
    const disputeSnap = await tx.get(disputeRef);
    if (!disputeSnap.exists) return { found: false, version: 1, createdBy: null, transferResult: null, touched: [] };
    const dispute = disputeSnap.data()!;
    const createdBy = String(dispute.createdBy ?? '');
    const version: 1 | 2 = dispute.version === 2 ? 2 : 1;

    if (via === 'ca') {
      if (dispute.assignedTo !== actorUid) {
        return { found: true, conflict: 'not-assigned', version, createdBy, transferResult: null, touched: [] };
      }
      if (dispute.CaApproval !== 'Pending' || dispute.AdminApproval !== 'Pending') {
        return { found: true, conflict: 'decided', version, createdBy, transferResult: null, touched: [] };
      }
    }

    const overturn = via === 'admin' && verdict === 'Rejected' && dispute.AdminApproval === 'Approved';
    // It takes back money an agent was told they have, so it must say why.
    if (overturn && (reason?.length ?? 0) < 3) {
      return { found: true, conflict: 'reason-required', version, createdBy, transferResult: null, touched: [] };
    }

    const approval: Record<string, unknown> = {
      ...(via === 'ca' ? { CaApproval: 'Approved' } : {}),
      AdminApproval: 'Approved',
      resolvedAt: FieldValue.serverTimestamp(),
      approvedAt: FieldValue.serverTimestamp(),
      approvedBy: actorUid,
      approvedVia: via,
    };
    // A CA rejection never touches AdminApproval (it is terminal for the filer
    // all the same); an admin rejection of an approved dispute is an overturn.
    const rejection: Record<string, unknown> =
      via === 'ca'
        ? { CaApproval: 'Rejected', resolvedAt: FieldValue.serverTimestamp() }
        : {
            AdminApproval: 'Rejected',
            resolvedAt: FieldValue.serverTimestamp(),
            ...(overturn
              ? { overturnedAt: FieldValue.serverTimestamp(), overturnedBy: actorUid, overturnReason: reason }
              : {}),
          };

    if (version !== 2) {
      tx.update(disputeRef, verdict === 'Approved' ? approval : rejection);
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
          // Held by the filer without this dispute moving it (BuddyX re-credited
          // it meanwhile): nothing to move, but the claim's lock must go.
          if (data?.disputeId === disputeId) tx.update(ref, { disputeId: null });
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
            kind: 'dispute',
            fromUserId: from,
            toUserId: createdBy,
            disputeId,
            sourceUserIdAtTransfer: data!.sourceUserId ?? null,
            reason: null,
            approvedBy: actorUid,
            approvedAt: Timestamp.now(),
          },
          transferFromUserId: from,
          userId: createdBy,
          disputeId: null,
          attributionConflict: false,
          assignmentLog: logEntry({ action: 'dispute', fromUserId: from, toUserId: createdBy, by: actorUid, reason: null, disputeId }),
        });
        result.transferred.push(ref.id);
        touched.add(`${createdBy}|${data!.month}`);
        if (from) touched.add(`${from}|${data!.month}`);
      }
      tx.update(disputeRef, { ...approval, transferResult: result });
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
          attributionConflict: false,
          assignmentLog: logEntry({
            action: 'revert',
            fromUserId: data.userId ?? null,
            toUserId: data.sourceUserId ?? null,
            by: actorUid,
            reason: 'Dispute verdict changed to rejected',
            disputeId,
          }),
        });
        touched.add(`${createdBy}|${data.month}`);
        if (data.sourceUserId) touched.add(`${data.sourceUserId}|${data.month}`);
      } else if (data.disputeId === disputeId) {
        tx.update(ref, { disputeId: null });
      }
    }
    tx.update(disputeRef, rejection);
    return { found: true, version: 2, createdBy, transferResult: null, touched: [...touched] };
  });

  return outcome;
}

// ─── Reassignment and un-transfer ────────────────────────────────────

export type ReassignOutcome =
  | { ok: true; disputeId: string | null; touched: string[] }
  | { ok: false; status: number; error: string };

/**
 * An admin moves one sale to `toUserId` (`null` = nobody, `'source'` = back
 * onto whoever BuddyX credits now, read inside the transaction), from CA Admin →
 * Sales. Bluu Backend is the source of truth for who holds a sale, so this is
 * a `transfer` (`kind: 'admin'`, reason required) that every later sync keeps.
 *
 * Moving it to the agent BuddyX credits clears the transfer instead — the sale
 * matches BuddyX again. If the transfer being replaced or cleared came from a
 * dispute, the dispute records it under `untransfers`, so its detail shows
 * that sale as reverted rather than still moved.
 *
 * The rules (`reassignRefusal`) run inside the transaction: open months only
 * for both agents, never under an open dispute, never a removed row. Infloww
 * history moves like any other sale.
 */
export async function reassignSale(params: {
  saleId: string;
  toUserId: string | null | 'source';
  actorUid: string;
  reason: string;
}): Promise<ReassignOutcome> {
  const { saleId, actorUid, reason } = params;
  const ref = adminDb.collection(SALES).doc(saleId);

  return adminDb.runTransaction(async (tx): Promise<ReassignOutcome> => {
    const snap = await tx.get(ref);
    const sale = snap.exists ? (snap.data() as CaSaleDocument) : null;

    // An Infloww row written before `sourceUserId` existed was attributed to
    // its holder — the same default `serialiseSale` reads — and the move pins
    // it, so the original attribution survives the first transfer.
    const source = sale ? (sale.sourceUserId !== undefined ? sale.sourceUserId : (sale.userId ?? null)) : null;
    const pinSource = sale !== null && sale.sourceUserId === undefined;
    const toUserId = params.toUserId === 'source' ? source : params.toUserId;

    // A lock whose dispute is already decided is stale: it does not block the
    // move, and the move clears it.
    let openLock = sale?.disputeId ?? null;
    if (openLock && lockIsStale(await tx.get(adminDb.collection(DISPUTES).doc(openLock)))) openLock = null;

    const pairs = new Set<string>();
    if (sale?.userId) pairs.add(`${sale.userId}|${sale.month}`);
    if (sale && toUserId) pairs.add(`${toUserId}|${sale.month}`);
    const finalized = await finalizedIn(tx, pairs);

    const refusal = reassignRefusal(
      sale && {
        userId: sale.userId ?? null,
        sourceUserId: source,
        hasTransfer: Boolean(sale.transfer),
        removed: Boolean(sale.removedAt),
        disputeId: openLock,
        month: sale.month,
      },
      toUserId,
      (uid, month) => finalized.has(`${uid}|${month}`),
    );
    if (refusal || !sale) {
      const { status, message } = REASSIGN_REFUSAL[refusal ?? 'not-found'];
      return { ok: false, status, error: message };
    }

    const from = sale.userId ?? null;
    const backToSource = toUserId === source;
    const replacedDisputeId = sale.transfer?.disputeId ?? null;
    tx.update(ref, {
      transfer: backToSource
        ? null
        : {
            kind: 'admin',
            fromUserId: from,
            toUserId,
            disputeId: null,
            sourceUserIdAtTransfer: source,
            reason,
            approvedBy: actorUid,
            approvedAt: Timestamp.now(),
          },
      transferFromUserId: backToSource ? null : from,
      userId: toUserId,
      ...(pinSource ? { sourceUserId: source } : {}),
      disputeId: null,
      attributionConflict: false,
      assignmentLog: logEntry({
        action: backToSource ? 'revert' : 'admin',
        fromUserId: from,
        toUserId,
        by: actorUid,
        reason,
        disputeId: replacedDisputeId,
      }),
    });
    if (replacedDisputeId) {
      tx.set(
        adminDb.collection(DISPUTES).doc(replacedDisputeId),
        { untransfers: FieldValue.arrayUnion({ saleId, by: actorUid, at: Timestamp.now(), reason }) },
        { merge: true },
      );
    }

    const touched: string[] = [];
    if (from) touched.push(`${from}|${sale.month}`);
    if (toUserId && toUserId !== from) touched.push(`${toUserId}|${sale.month}`);
    return { ok: true, disputeId: replacedDisputeId, touched };
  });
}

/**
 * Revert one transfer — dispute or admin — the escape hatch for a wrong
 * approval. The sale goes back to whoever BuddyX attributes it to *now*.
 * A thin front on `reassignSale`, so there is one implementation of a holder
 * change.
 */
export function untransferSale(params: { saleId: string; actorUid: string; reason: string }): Promise<ReassignOutcome> {
  return reassignSale({ ...params, toUserId: 'source' });
}
