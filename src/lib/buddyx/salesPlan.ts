/**
 * BuddyX tips + PPVs → the `ca-sales` writes one sync run should make. Pure.
 *
 * The sync service reads; this decides; the service writes. Keeping the
 * decision pure is what lets the attribution invariant, the finalised guard and
 * the vanished-row guard be pinned by tests — they are the money path.
 *
 * ## The attribution invariant
 *
 * A sale's **effective holder** is `transfer?.toUserId ?? sourceUserId`, and
 * `userId` always equals it. The source attribution (`sourceUserId`) is
 * re-read every run, because BuddyX can re-attribute a tip after the fact, but
 * **a sync never clears a transfer**: once an approved dispute has moved a
 * sale, Bluu Backend is the source of truth. If BuddyX later re-attributes a
 * transferred sale to someone other than the agent it was moved off, the
 * transfer stands and the row is flagged `attributionConflict` for an admin —
 * never resolved silently.
 *
 * ## Write only what changed
 *
 * Every synced field is fingerprinted (`syncHash`). A row whose fingerprint is
 * unchanged is not written, so a steady-state run writes only new rows (rule 9).
 *
 * ## The finalised guard
 *
 * A row whose month is finalised for its **stored** holder or its **new**
 * holder is never written — the frozen month is what was paid. It is reported
 * under `rejectedFinalized` instead, for CA Admin → Sales.
 *
 * ## Vanished rows
 *
 * A stored row the API no longer returns is soft-removed (`removedAt`) — only
 * when **both endpoints paginated to completion** this run (`complete`), since a
 * partial fetch would otherwise remove real sales — and never inside a
 * finalised month, where it is flagged `vanishedAfterFinalise` and left
 * counting. A removed row that reappears is restored.
 */
import { createHash } from 'node:crypto';
import { salesSourceFor } from '../salary/salaryConstants';
import { toDayKey, toMonthKey } from '../salary/salaryDate';
import { normaliseSaleType } from '../salary/saleTypes';
import { round2 } from '../salary/salaryEngine';
import { normaliseId, type BuddyxPpvRow, type BuddyxTipRow } from './types';

// ─── Normalisation ───────────────────────────────────────────────────

/** One BuddyX revenue row in the shape the planner works on. */
export interface NormalisedSale {
  saleId: string;
  sourceId: string;
  kind: 'tip' | 'ppv';
  type: string;
  occurredAtMs: number;
  modelId: string | null;
  modelHandle: string | null;
  chatterId: string | null;
  chatterName: string | null;
  fanId: string;
  gross: number;
  net: number;
}

/** Deterministic, so a re-sync upserts the same document. */
export const tipSaleId = (id: string) => `bx-tip-${id}`;
export const ppvSaleId = (id: string) => `bx-ppv-${id}`;

/**
 * A tip row, or `null` when it cannot be placed: no id, no timestamp, or dated
 * at/before the cutover (Infloww owns that side — `salesSourceFor`).
 */
export function normaliseTip(row: BuddyxTipRow): NormalisedSale | null {
  const id = normaliseId(row.id);
  const at = row.datePurchase ? Date.parse(row.datePurchase) : NaN;
  if (!id || !Number.isFinite(at) || salesSourceFor(at) !== 'buddyx') return null;
  const gross = round2(Number(row.amount?.gross ?? 0));
  return {
    saleId: tipSaleId(id),
    sourceId: id,
    kind: 'tip',
    type: normaliseSaleType(row.type ?? 'tips'),
    occurredAtMs: at,
    modelId: normaliseId(row.modelId),
    modelHandle: row.modelHandle ?? null,
    chatterId: normaliseId(row.chatterId),
    chatterName: row.chatterName ?? null,
    fanId: normaliseId(row.fanId) ?? '',
    gross,
    // Per the API's rounding guidance, net is derived from gross rather than
    // trusted per row — it is what every aggregate does.
    net: round2(gross * 0.8),
  };
}

/** A PPV row. PPVs have no `type`; they are dated by `unlockDate`. */
export function normalisePpv(row: BuddyxPpvRow): NormalisedSale | null {
  const id = normaliseId(row.id);
  const raw = row.unlockDate ?? row.createdAt;
  const at = raw ? Date.parse(raw) : NaN;
  if (!id || !Number.isFinite(at) || salesSourceFor(at) !== 'buddyx') return null;
  const gross = round2(Number(row.revenue?.gross ?? 0));
  return {
    saleId: ppvSaleId(id),
    sourceId: id,
    kind: 'ppv',
    type: 'ppv',
    occurredAtMs: at,
    modelId: normaliseId(row.modelId),
    modelHandle: row.modelHandle ?? null,
    chatterId: normaliseId(row.chatterId),
    chatterName: row.chatterName ?? null,
    fanId: normaliseId(row.fanId) ?? '',
    gross,
    net: round2(gross * 0.8),
  };
}

// ─── Planner inputs ──────────────────────────────────────────────────

export interface ChatterRef {
  uid: string | null;
  email: string | null;
  name: string | null;
}

export interface ModelRef {
  creatorId: string | null;
  creatorName: string | null;
  handle: string | null;
}

/** A stored BuddyX row, field-masked to what the planner needs. */
export interface StoredSale {
  saleId: string;
  userId: string | null;
  month: string;
  transfer: { fromUserId: string | null; toUserId: string } | null;
  removed: boolean;
  syncHash: string | null;
  vanishedAfterFinalise: boolean;
}

/** `uid|month` — the key a finalised agent-month is looked up by. */
export const pairKey = (uid: string, month: string) => `${uid}|${month}`;

// ─── Derivation ──────────────────────────────────────────────────────

/** Everything the sync stores about a row, except the fan name and run stamps. */
export interface DerivedSale {
  saleId: string;
  sourceId: string;
  source: 'buddyx';
  kind: 'tip' | 'ppv';
  type: string;
  occurredAtMs: number;
  day: string;
  month: string;
  modelId: string | null;
  modelHandle: string | null;
  creatorId: string | null;
  creatorName: string;
  chatterId: string | null;
  employeeName: string;
  sourceEmail: string;
  fanId: string;
  grossRevenue: number;
  netRevenue: number;
  signedGross: number;
  status: 'complete';
  rule: string;
  assignedBy: string;
  sourceUserId: string | null;
  userId: string | null;
  unmappedChatterId: string | null;
  attributionConflict: boolean;
  removedAt: null;
  vanishedAfterFinalise: boolean;
  syncHash: string;
}

export function deriveSale(
  sale: NormalisedSale,
  stored: StoredSale | undefined,
  chatters: Map<string, ChatterRef>,
  models: Map<string, ModelRef>,
): DerivedSale {
  const chatter = sale.chatterId ? chatters.get(sale.chatterId) : undefined;
  const model = sale.modelId ? models.get(sale.modelId) : undefined;
  const sourceUserId = chatter?.uid ?? null;
  const transfer = stored?.transfer ?? null;

  const base = {
    saleId: sale.saleId,
    sourceId: sale.sourceId,
    source: 'buddyx' as const,
    kind: sale.kind,
    type: sale.type,
    occurredAtMs: sale.occurredAtMs,
    day: toDayKey(sale.occurredAtMs),
    month: toMonthKey(sale.occurredAtMs),
    modelId: sale.modelId,
    modelHandle: sale.modelHandle ?? model?.handle ?? null,
    creatorId: model?.creatorId ?? null,
    // The stage name the rest of CA salary joins and displays on; the handle
    // only when the model is not mapped yet.
    creatorName: model?.creatorName ?? sale.modelHandle ?? model?.handle ?? '',
    chatterId: sale.chatterId,
    employeeName: sale.chatterName ?? chatter?.name ?? '',
    sourceEmail: chatter?.email ?? '',
    fanId: sale.fanId,
    grossRevenue: sale.gross,
    netRevenue: sale.net,
    signedGross: sale.gross,
    status: 'complete' as const,
    rule: '',
    assignedBy: '',
    sourceUserId,
    // The invariant: a transfer is never cleared by a sync.
    userId: transfer ? transfer.toUserId : sourceUserId,
    unmappedChatterId: sale.chatterId && !sourceUserId ? sale.chatterId : null,
    attributionConflict: transfer ? sourceUserId !== transfer.fromUserId : false,
    removedAt: null,
    vanishedAfterFinalise: false,
  };

  const syncHash = createHash('sha1').update(JSON.stringify(base)).digest('hex').slice(0, 20);
  return { ...base, syncHash };
}

/** Every agent-month a run could touch, so the caller can read finalisation in one batch. */
export function collectHolderPairs(
  sales: NormalisedSale[],
  stored: Map<string, StoredSale>,
  chatters: Map<string, ChatterRef>,
  models: Map<string, ModelRef>,
): Set<string> {
  const pairs = new Set<string>();
  for (const sale of sales) {
    const prev = stored.get(sale.saleId);
    const next = deriveSale(sale, prev, chatters, models);
    if (next.userId) pairs.add(pairKey(next.userId, next.month));
    if (prev?.userId) pairs.add(pairKey(prev.userId, prev.month));
  }
  for (const prev of stored.values()) if (prev.userId) pairs.add(pairKey(prev.userId, prev.month));
  return pairs;
}

// ─── The plan ────────────────────────────────────────────────────────

export interface SalesPlan {
  /** Rows to write (new, changed, or restored). */
  upserts: Array<{ sale: DerivedSale; isNew: boolean }>;
  /** Stored rows to soft-remove. */
  removals: string[];
  /** Stored rows that vanished inside a finalised month — flagged, left counting. */
  vanishedFlags: string[];
  /** Rows not written because a finalised month owns them. */
  rejectedFinalized: Array<{ saleId: string; months: string[] }>;
  /** Agent-months whose figures this plan moves — for the commission-tier notice. */
  touched: Set<string>;
  /** Chatter ids carrying sales that resolve to no user, with what they carry. */
  unmappedChatters: Map<string, { name: string | null; rows: number; gross: number }>;
  counts: {
    fetched: number;
    new: number;
    changed: number;
    unchanged: number;
    restored: number;
    removed: number;
    vanishedAfterFinalise: number;
    rejectedFinalized: number;
    attributionConflicts: number;
    unassigned: number;
  };
}

export function planSalesSync(params: {
  sales: NormalisedSale[];
  stored: Map<string, StoredSale>;
  chatters: Map<string, ChatterRef>;
  models: Map<string, ModelRef>;
  /** `uid|month` pairs that are finalised. */
  finalized: Set<string>;
  /** Both endpoints paginated to completion — the only condition under which anything is removed. */
  complete: boolean;
}): SalesPlan {
  const { stored, chatters, models, finalized, complete } = params;

  // A restarted pagination can yield a row twice; the id is the identity.
  const sales = new Map<string, NormalisedSale>();
  for (const sale of params.sales) sales.set(sale.saleId, sale);

  const plan: SalesPlan = {
    upserts: [],
    removals: [],
    vanishedFlags: [],
    rejectedFinalized: [],
    touched: new Set(),
    unmappedChatters: new Map(),
    counts: {
      fetched: sales.size,
      new: 0,
      changed: 0,
      unchanged: 0,
      restored: 0,
      removed: 0,
      vanishedAfterFinalise: 0,
      rejectedFinalized: 0,
      attributionConflicts: 0,
      unassigned: 0,
    },
  };

  const isFinal = (uid: string | null, month: string) => uid !== null && finalized.has(pairKey(uid, month));

  for (const sale of sales.values()) {
    const prev = stored.get(sale.saleId);
    const next = deriveSale(sale, prev, chatters, models);

    if (next.unmappedChatterId) {
      const entry = plan.unmappedChatters.get(next.unmappedChatterId) ?? { name: next.employeeName || null, rows: 0, gross: 0 };
      entry.rows += 1;
      entry.gross = round2(entry.gross + next.grossRevenue);
      plan.unmappedChatters.set(next.unmappedChatterId, entry);
    }
    if (!next.userId) plan.counts.unassigned += 1;
    if (next.attributionConflict) plan.counts.attributionConflicts += 1;

    const changed = !prev || prev.removed || prev.syncHash !== next.syncHash;
    if (!changed) {
      plan.counts.unchanged += 1;
      continue;
    }

    const frozen: string[] = [];
    if (prev && isFinal(prev.userId, prev.month)) frozen.push(prev.month);
    if (isFinal(next.userId, next.month) && !frozen.includes(next.month)) frozen.push(next.month);
    if (frozen.length > 0) {
      plan.rejectedFinalized.push({ saleId: next.saleId, months: frozen });
      plan.counts.rejectedFinalized += 1;
      continue;
    }

    plan.upserts.push({ sale: next, isNew: !prev });
    if (!prev) plan.counts.new += 1;
    else if (prev.removed) plan.counts.restored += 1;
    else plan.counts.changed += 1;

    if (next.userId) plan.touched.add(pairKey(next.userId, next.month));
    if (prev?.userId) plan.touched.add(pairKey(prev.userId, prev.month));
  }

  if (complete) {
    for (const prev of stored.values()) {
      if (prev.removed || sales.has(prev.saleId)) continue;
      if (isFinal(prev.userId, prev.month)) {
        if (!prev.vanishedAfterFinalise) {
          plan.vanishedFlags.push(prev.saleId);
          plan.counts.vanishedAfterFinalise += 1;
        }
        continue;
      }
      plan.removals.push(prev.saleId);
      plan.counts.removed += 1;
      if (prev.userId) plan.touched.add(pairKey(prev.userId, prev.month));
    }
  }

  return plan;
}
