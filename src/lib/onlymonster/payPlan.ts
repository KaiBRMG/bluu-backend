/**
 * The OnlyMonster pay derivation — `ca-sales` rows from the account ledger. Pure.
 * (Migration plan §5; decisions D2, D3, D8, D16, D17.)
 *
 * Every invariant of BuddyX's `planSalesSync` carries over unchanged (plan §2.3):
 *
 * - **Identity.** A row's id is `om-{platformAccountId}_{transactionId}`, minted
 *   once and never changed; a row is found by its transaction, never by its holder.
 * - **A derivation never clears a transfer.** `userId = transfer ? transfer.toUserId : sourceUserId`.
 * - **Finalised months are frozen.** A change that touches a month finalised for
 *   the stored or the new holder is refused and counted.
 * - **Only changed rows are written** (`syncHash`).
 *
 * What is new:
 *
 * - **Strict attribution (D2).** Exactly one agent scheduled on the sale's
 *   account at its instant gets it (`schedule`). Nobody → `unscheduled`, several
 *   → `overlap` (candidates kept in `scheduledUids`), the only candidate had left
 *   → `departed`. All three are unassigned (`sourceUserId: null`) and flagged; no
 *   fallback, no grace window, intervals half-open `[start, end)`.
 * - **Departed agents (D8).** An occurrence is clamped to end at its agent's
 *   departure, so a shift that began before someone left credits them nothing after.
 * - **Tips and PPV messages only (D3).** Every other category stays in the account ledger.
 * - **Statuses (D16).** `done` and `loading` count; `pending_return` counts and is
 *   flagged (`txStatus`); anything else counts and is flagged as unknown.
 * - **Chargebacks (D17).** OnlyFans deletes a charged-back original; the row of
 *   a vanished transaction is **soft-removed**, which is the deduction. Only where
 *   that cannot happen does a negative row land on the chargeback's own day:
 *   (a) the original sits in a month finalised for its holder (`vanishedAfterFinalise`);
 *   (b) the original is a pre-cutover `bx-*` / Infloww row, which this migration
 *   never modifies (invariant 1). That row is credited to the original's current
 *   holder and guarded by the finalised check on **its own** month.
 */
import { createHash } from 'crypto';
import { matchSalesToSchedule, type Departures, type ScheduleOccurrence } from '../salary/scheduleMatch';
import { toDayKey, toMonthKey } from '../salary/salaryDate';
import { payKindOf, type TransactionCategory } from './classify';
import { round2 } from '../salary/salaryEngine';
import type { LedgerTx } from './ledger';

export type OmAttribution = 'schedule' | 'unscheduled' | 'overlap' | 'departed' | 'chargeback';

export const omSaleId = (platformAccountId: string, txId: string) => `om-${platformAccountId}_${txId}`;
export const omChargebackSaleId = (chargebackId: string) => `om-cb-${chargebackId}`;
export const pairKey = (uid: string, month: string) => `${uid}|${month}`;


/** One ledger transaction, with the account it belongs to. */
export interface LedgerSaleInput {
  platformAccountId: string;
  creatorId: string;
  creatorName: string;
  txId: string;
  tx: LedgerTx;
}

/** A stored `om-*` row, field-masked to what the planner needs. */
export interface StoredOmSale {
  saleId: string;
  userId: string | null;
  month: string;
  transfer: { toUserId: string | null; sourceUserIdAtTransfer: string | null } | null;
  removed: boolean;
  syncHash: string | null;
  vanishedAfterFinalise: boolean;
}

/** A matched chargeback whose deduction may need its own row (D17 cases a and b). */
export interface ChargebackInput {
  chargebackId: string;
  amount: number;
  category: TransactionCategory;
  chargebackAtMs: number;
  /** For case (a): the `om-*` original. */
  originalSaleId: string | null;
  /** For case (b): a pre-cutover original (`bx-*` / Infloww), resolved by fact match. */
  preCutoverOriginal: { saleId: string; userId: string | null; month: string } | null;
  fanId: string;
  creatorId: string;
  creatorName: string;
}

export interface DerivedOmSale {
  saleId: string;
  source: 'onlymonster';
  sourceId: string;
  transactionId: string | null;
  kind: 'tip' | 'ppv';
  type: 'tips' | 'ppv';
  occurredAtMs: number;
  day: string;
  month: string;
  creatorId: string;
  creatorName: string;
  fanId: string;
  grossRevenue: number;
  netRevenue: number;
  signedGross: number;
  status: 'complete' | 'reverse';
  sourceUserId: string | null;
  attributedBy: OmAttribution;
  scheduledUids: string[];
  userId: string | null;
  txStatus: string;
  reversesSaleId: string | null;
  attributionConflict: boolean;
  removedAt: null;
  vanishedAfterFinalise: boolean;
  syncHash: string;
}

/** D8: each occurrence ends no later than its agent's departure; one that starts after it is dropped. */
export function clampDeparted<T extends ScheduleOccurrence>(occurrences: T[], departures: Departures | undefined): T[] {
  if (!departures?.size) return occurrences;
  const out: T[] = [];
  for (const o of occurrences) {
    const left = departures.get(o.userId);
    if (left === undefined) out.push(o);
    else if (o.occurrenceStart < left) out.push({ ...o, occurrenceEnd: Math.min(o.occurrenceEnd, left) });
  }
  return out;
}

export interface Attribution {
  sourceUserId: string | null;
  attributedBy: Exclude<OmAttribution, 'chargeback'>;
  scheduledUids: string[];
}

/** Strict shift attribution for every sale (D2, D8). `sales` carries id, creator and instant. */
export function attributeAll(
  sales: Array<{ saleId: string; creatorId: string; occurredAtMs: number }>,
  occurrences: ScheduleOccurrence[],
  departures: Departures | undefined,
): Map<string, Attribution> {
  const asSched = sales.map(s => ({ saleId: s.saleId, userId: null, creatorId: s.creatorId, occurredAt: new Date(s.occurredAtMs).toISOString(), removedAt: null }));
  // No grace (D2): grace only ever widened the *holder's* window, and the holder here is null.
  const live = matchSalesToSchedule(asSched, clampDeparted(occurrences, departures), 0);
  const raw = departures?.size ? matchSalesToSchedule(asSched, occurrences, 0) : live;
  const out = new Map<string, Attribution>();
  for (const s of sales) {
    const scheduled = live.get(s.saleId)?.scheduled ?? [];
    if (scheduled.length === 1) out.set(s.saleId, { sourceUserId: scheduled[0], attributedBy: 'schedule', scheduledUids: scheduled });
    else if (scheduled.length > 1) out.set(s.saleId, { sourceUserId: null, attributedBy: 'overlap', scheduledUids: scheduled });
    else {
      const before = raw.get(s.saleId)?.scheduled ?? [];
      out.set(s.saleId, { sourceUserId: null, attributedBy: before.length ? 'departed' : 'unscheduled', scheduledUids: [] });
    }
  }
  return out;
}

function hashOf(base: object): string {
  return createHash('sha1').update(JSON.stringify(base)).digest('hex').slice(0, 20);
}

export function deriveOmSale(input: LedgerSaleInput, attribution: Attribution, stored: StoredOmSale | undefined): DerivedOmSale | null {
  const kind = payKindOf(input.tx.cat);
  if (!kind || input.tx.gross === null) return null;
  const transfer = stored?.transfer ?? null;
  const sourceUserId = attribution.sourceUserId;
  const base = {
    saleId: omSaleId(input.platformAccountId, input.txId),
    source: 'onlymonster' as const,
    sourceId: input.txId,
    transactionId: input.txId,
    kind,
    type: kind === 'tip' ? ('tips' as const) : ('ppv' as const),
    occurredAtMs: input.tx.t,
    day: toDayKey(input.tx.t),
    month: toMonthKey(input.tx.t),
    creatorId: input.creatorId,
    creatorName: input.creatorName,
    fanId: input.tx.fan,
    grossRevenue: input.tx.gross,
    netRevenue: input.tx.net ?? round2(input.tx.gross * 0.8),
    signedGross: input.tx.gross,
    status: 'complete' as const,
    sourceUserId,
    attributedBy: attribution.attributedBy,
    scheduledUids: attribution.scheduledUids,
    // The invariant: a transfer is never cleared by a derivation.
    userId: transfer ? transfer.toUserId : sourceUserId,
    txStatus: input.tx.status,
    reversesSaleId: null,
    attributionConflict: transfer ? sourceUserId !== transfer.sourceUserIdAtTransfer && sourceUserId !== transfer.toUserId : false,
    removedAt: null,
    vanishedAfterFinalise: false,
  };
  return { ...base, syncHash: hashOf(base) };
}

export function deriveChargebackRow(cb: ChargebackInput, holder: string | null, original: string): DerivedOmSale | null {
  const kind = payKindOf(cb.category);
  if (!kind) return null;
  const base = {
    saleId: omChargebackSaleId(cb.chargebackId),
    source: 'onlymonster' as const,
    sourceId: cb.chargebackId,
    transactionId: null,
    kind,
    type: kind === 'tip' ? ('tips' as const) : ('ppv' as const),
    occurredAtMs: cb.chargebackAtMs,
    day: toDayKey(cb.chargebackAtMs),
    month: toMonthKey(cb.chargebackAtMs),
    creatorId: cb.creatorId,
    creatorName: cb.creatorName,
    fanId: cb.fanId,
    grossRevenue: Math.abs(cb.amount),
    netRevenue: round2(Math.abs(cb.amount) * 0.8),
    signedGross: -Math.abs(cb.amount),
    status: 'reverse' as const,
    // Credited to whoever holds the original now, transfers included (§5.5 step 4).
    sourceUserId: holder,
    attributedBy: 'chargeback' as const,
    scheduledUids: [],
    userId: holder,
    txStatus: 'chargeback',
    reversesSaleId: original,
    attributionConflict: false,
    removedAt: null,
    vanishedAfterFinalise: false,
  };
  return { ...base, syncHash: hashOf(base) };
}

export interface PayPlan {
  upserts: Array<{ sale: DerivedOmSale; isNew: boolean }>;
  removals: string[];
  vanishedFlags: string[];
  rejectedFinalized: Array<{ saleId: string; months: string[] }>;
  touched: Set<string>;
  counts: Record<string, number>;
}

/**
 * @param inputs       every tip / PPV ledger transaction the derivation owns
 *                     (after the cutover, or in the shadow window), **removed ones included**
 * @param stored       the stored `om-*` rows for the window's months
 * @param attributions `attributeAll` over the inputs
 * @param chargebacks  matched chargebacks that may need their own row
 * @param finalized    `uid|month` pairs that are finalised
 */
export function planPay(params: {
  inputs: LedgerSaleInput[];
  stored: Map<string, StoredOmSale>;
  attributions: Map<string, Attribution>;
  chargebacks: ChargebackInput[];
  finalized: Set<string>;
}): PayPlan {
  const { inputs, stored, attributions, chargebacks, finalized } = params;
  const plan: PayPlan = { upserts: [], removals: [], vanishedFlags: [], rejectedFinalized: [], touched: new Set(), counts: {} };
  const bump = (k: string) => (plan.counts[k] = (plan.counts[k] ?? 0) + 1);
  const isFinal = (uid: string | null, month: string) => uid !== null && finalized.has(pairKey(uid, month));
  const seen = new Set<string>();

  const write = (next: DerivedOmSale) => {
    const prev = stored.get(next.saleId);
    seen.add(next.saleId);
    if (prev && !prev.removed && prev.syncHash === next.syncHash) return bump('unchanged');
    const frozen: string[] = [];
    if (prev && isFinal(prev.userId, prev.month)) frozen.push(prev.month);
    if (isFinal(next.userId, next.month) && !frozen.includes(next.month)) frozen.push(next.month);
    if (frozen.length) {
      plan.rejectedFinalized.push({ saleId: next.saleId, months: frozen });
      return bump('rejectedFinalized');
    }
    plan.upserts.push({ sale: next, isNew: !prev });
    bump(!prev ? 'new' : prev.removed ? 'restored' : 'changed');
    if (next.userId) plan.touched.add(pairKey(next.userId, next.month));
    if (prev?.userId) plan.touched.add(pairKey(prev.userId, prev.month));
  };

  const vanishedFinal = new Set<string>();
  for (const input of inputs) {
    const id = omSaleId(input.platformAccountId, input.txId);
    const prev = stored.get(id);
    if (input.tx.removedAt) {
      // D17: the transaction vanished (OnlyFans deletes a charged-back original); the row goes too.
      seen.add(id);
      if (!prev || prev.removed) continue;
      if (isFinal(prev.userId, prev.month)) {
        vanishedFinal.add(id);
        if (!prev.vanishedAfterFinalise) {
          plan.vanishedFlags.push(id);
          bump('vanishedAfterFinalise');
        }
        continue;
      }
      plan.removals.push(id);
      bump('removed');
      if (prev.userId) plan.touched.add(pairKey(prev.userId, prev.month));
      continue;
    }
    const attribution = attributions.get(id) ?? { sourceUserId: null, attributedBy: 'unscheduled' as const, scheduledUids: [] };
    const next = deriveOmSale(input, attribution, prev);
    if (!next) continue;
    if (next.attributedBy !== 'schedule') bump(`unassigned.${next.attributedBy}`);
    if (next.txStatus === 'pending_return') bump('pendingReturn');
    write(next);
  }

  // D17 (a) and (b): the deduction gets its own row only where the original cannot be removed.
  for (const cb of chargebacks) {
    let holder: string | null = null;
    let original: string | null = null;
    if (cb.originalSaleId && vanishedFinal.has(cb.originalSaleId)) {
      const prev = stored.get(cb.originalSaleId)!;
      holder = prev.userId;
      original = cb.originalSaleId;
    } else if (cb.preCutoverOriginal) {
      holder = cb.preCutoverOriginal.userId;
      original = cb.preCutoverOriginal.saleId;
    } else continue;
    const row = deriveChargebackRow(cb, holder, original);
    if (!row) continue;
    bump('chargebackRows');
    write(row);
  }

  return plan;
}
