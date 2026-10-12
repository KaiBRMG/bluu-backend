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
 * **a sync never clears a transfer**: once an approved dispute or an admin
 * (CA Admin → Sales) has moved a sale, Bluu Backend is the source of truth.
 * If BuddyX later re-attributes a transferred sale to anyone other than whom
 * it credited when the transfer was made — and other than the agent Bluu now
 * holds it on — the transfer stands and the row is flagged
 * `attributionConflict` for an admin, never resolved silently. BuddyX coming
 * round to Bluu's answer is not a conflict.
 *
 * ## Identity — which stored sale a BuddyX row is
 *
 * A row is matched to its stored document by its **BuddyX id** (`sourceId`),
 * never by who it is attributed to, so a re-attribution in BuddyX updates the
 * same document rather than creating a second one. The document id is minted
 * from the BuddyX id the first time (`bx-tip-{id}`) and **never changes** —
 * disputes and the audit log reference it.
 *
 * Whether BuddyX keeps a tip-allocation's id when a manager reassigns it is
 * not stated in its spec. So, as a fallback, a row whose id is new is matched
 * to a stored row whose id vanished this run **when both carry the same facts**
 * (`saleMatchKey`: kind, model, fan, instant, gross) and the pairing is unique
 * on both sides. That row is *re-keyed*: same document, new `sourceId`, and a
 * transfer or dispute lock on it survives. An ambiguous pairing (two identical
 * tips) is never guessed — it falls through to remove + create, and is counted.
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
 * A row's id and instant, or `null` when it has neither a usable id nor a
 * parseable date — a row that cannot be placed at all. The one rule the
 * normalisers and the sync's `sales.unplaceable` count share.
 */
export function placeRow(rawId: string | number | null | undefined, rawDate: string | null | undefined): { id: string; at: number } | null {
  const id = normaliseId(rawId);
  const at = rawDate ? Date.parse(rawDate) : NaN;
  return id && Number.isFinite(at) ? { id, at } : null;
}

/**
 * A tip row, or `null` when it cannot be placed (`placeRow`) or is dated
 * at/before the cutover (Infloww owns that side — `salesSourceFor`).
 */
export function normaliseTip(row: BuddyxTipRow): NormalisedSale | null {
  const placed = placeRow(row.id, row.datePurchase);
  if (!placed || salesSourceFor(placed.at) !== 'buddyx') return null;
  const { id, at } = placed;
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
  const placed = placeRow(row.id, row.unlockDate ?? row.createdAt);
  if (!placed || salesSourceFor(placed.at) !== 'buddyx') return null;
  const { id, at } = placed;
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

/** A stored row's transfer, as far as the planner cares. */
export interface StoredTransfer {
  toUserId: string | null;
  /**
   * BuddyX's attribution when the transfer was made. The reader resolves the
   * legacy case (transfers written before the field existed → `fromUserId`).
   */
  sourceUserIdAtTransfer: string | null;
}

/** A stored BuddyX row, field-masked to what the planner needs. */
export interface StoredSale {
  saleId: string;
  /** The BuddyX row id the document currently tracks. */
  sourceId: string;
  kind: 'tip' | 'ppv';
  /** `saleMatchKey` of the stored facts, for the re-key fallback. `null` when unknown. */
  matchKey: string | null;
  userId: string | null;
  month: string;
  transfer: StoredTransfer | null;
  removed: boolean;
  syncHash: string | null;
  vanishedAfterFinalise: boolean;
}

/**
 * The facts that identify a sale independently of its BuddyX id: what kind,
 * which model, which fan, the instant, and the gross in cents. Used only to
 * pair a vanished id with a new one (see "Identity" above), and to spot
 * possible duplicates on CA Admin → Sales.
 */
export function saleMatchKey(sale: {
  kind: 'tip' | 'ppv';
  modelId: string | null;
  fanId: string;
  occurredAtMs: number;
  gross: number;
}): string {
  return [sale.kind, sale.modelId ?? '', sale.fanId, sale.occurredAtMs, Math.round(sale.gross * 100)].join('|');
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
    attributionConflict: transfer ? isAttributionConflict(transfer, sourceUserId) : false,
    removedAt: null,
    vanishedAfterFinalise: false,
  };

  const syncHash = createHash('sha1').update(JSON.stringify(base)).digest('hex').slice(0, 20);
  return { ...base, syncHash };
}

/**
 * BuddyX now credits the sale to someone it did not credit when the transfer
 * was made, and who is not the agent Bluu holds it on. A move that BuddyX has
 * since agreed with is not a conflict.
 */
export function isAttributionConflict(transfer: StoredTransfer, sourceUserId: string | null): boolean {
  return sourceUserId !== transfer.sourceUserIdAtTransfer && sourceUserId !== transfer.toUserId;
}

/** `map.get(key).push(value)`, creating the list on first use. */
function pushTo<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/** Rows pointed at their documents — what the planner and the preview work on. */
export interface ResolvedSales {
  /** Each row with `saleId` set to its document id. */
  sales: NormalisedSale[];
  rekeyed: Array<{ saleId: string; fromSourceId: string; toSourceId: string }>;
  ambiguous: number;
}

/**
 * Point each BuddyX row at the stored document it belongs to — by BuddyX id,
 * then by the unique-facts fallback — and mint ids for the genuinely new.
 * Run **once** per sync; every consumer takes the result. Pure.
 */
export function resolveSaleIdentities(incoming: NormalisedSale[], stored: Map<string, StoredSale>): ResolvedSales {
  const bySource = new Map<string, StoredSale>();
  for (const row of stored.values()) bySource.set(`${row.kind}:${row.sourceId}`, row);

  // A restarted pagination can yield a row twice; the BuddyX id is the identity.
  const unique = new Map<string, NormalisedSale>();
  for (const sale of incoming) unique.set(`${sale.kind}:${sale.sourceId}`, sale);

  const out: NormalisedSale[] = [];
  const claimed = new Set<string>();
  const unmatched: NormalisedSale[] = [];
  for (const [key, sale] of unique) {
    const doc = bySource.get(key);
    if (doc) {
      claimed.add(doc.saleId);
      out.push({ ...sale, saleId: doc.saleId });
    } else {
      unmatched.push(sale);
    }
  }

  // Fallback: pair a new id with a vanished one carrying identical facts —
  // only when the pairing is unique on both sides.
  const newByKey = new Map<string, NormalisedSale[]>();
  for (const sale of unmatched) pushTo(newByKey, saleMatchKey(sale), sale);
  const goneByKey = new Map<string, StoredSale[]>();
  for (const row of stored.values()) {
    if (!claimed.has(row.saleId) && row.matchKey) pushTo(goneByKey, row.matchKey, row);
  }

  const rekeyed: ResolvedSales['rekeyed'] = [];
  let ambiguous = 0;
  const taken = new Set(stored.keys());
  for (const [key, fresh] of newByKey) {
    const gone = goneByKey.get(key);
    if (gone && fresh.length === 1 && gone.length === 1) {
      const doc = gone[0];
      claimed.add(doc.saleId);
      out.push({ ...fresh[0], saleId: doc.saleId });
      rekeyed.push({ saleId: doc.saleId, fromSourceId: doc.sourceId, toSourceId: fresh[0].sourceId });
      continue;
    }
    if (gone) ambiguous += fresh.length;
    for (const sale of fresh) {
      // A document id is never reused: a re-keyed row keeps its original id,
      // so BuddyX handing that old id to a different sale must not overwrite it.
      let id = sale.saleId;
      for (let n = 2; taken.has(id); n++) id = `${sale.saleId}~${n}`;
      taken.add(id);
      out.push({ ...sale, saleId: id });
    }
  }
  return { sales: out, rekeyed, ambiguous };
}

/** Every agent-month a run could touch, so the caller can read finalisation in one batch. Takes resolved rows. */
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
  /** Documents whose BuddyX id changed, matched by their facts (see "Identity"). */
  rekeyed: Array<{ saleId: string; fromSourceId: string; toSourceId: string }>;
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
    rekeyed: number;
    /** New ids that matched a vanished row's facts, but not uniquely — not guessed. */
    rekeyAmbiguous: number;
  };
}

export function planSalesSync(params: {
  /** From `resolveSaleIdentities` — the same result the caller fed `collectHolderPairs`. */
  identity: ResolvedSales;
  stored: Map<string, StoredSale>;
  chatters: Map<string, ChatterRef>;
  models: Map<string, ModelRef>;
  /** `uid|month` pairs that are finalised. */
  finalized: Set<string>;
  /** Both endpoints paginated to completion — the only condition under which anything is removed. */
  complete: boolean;
}): SalesPlan {
  const { identity, stored, chatters, models, finalized, complete } = params;

  const sales = new Map<string, NormalisedSale>();
  for (const sale of identity.sales) sales.set(sale.saleId, sale);

  const plan: SalesPlan = {
    upserts: [],
    removals: [],
    vanishedFlags: [],
    rejectedFinalized: [],
    touched: new Set(),
    unmappedChatters: new Map(),
    rekeyed: identity.rekeyed,
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
      rekeyed: identity.rekeyed.length,
      rekeyAmbiguous: identity.ambiguous,
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
