/**
 * The `derive` stage: OnlyMonster pay rows from the account ledger (migration
 * plan §5, Phases 3–4). Firestore only — no API call.
 *
 * **Where it writes is decided by two switches, both server-side:**
 *
 * | `ONLYMONSTER_CUTOVER_AT` | `config.salesWriteEnabled` | Writes to | Owns |
 * |---|---|---|---|
 * | `Infinity` (Phases 1–3) | any | `ca-sales-shadow` | every tip / PPV in the payroll window |
 * | a set instant (Phase 4) | `false` | `ca-sales-shadow` | as above |
 * | a set instant | `true` | **`ca-sales`** | tips / PPV **after** the cutover only (invariant 2) |
 *
 * Shadow rows are the Phase 3 evidence: the Shadow reconciliation view
 * compares them with what BuddyX paid. They never reach pay.
 *
 * The decisions are made by the pure planner (`lib/onlymonster/payPlan.ts`);
 * this file reads and writes around it, the same split as BuddyX's sync.
 */
import 'server-only';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '../firebase-admin';
import { COLLECTIONS } from '../onlymonster/constants';
import { bucketId } from '../onlymonster/ledger';
import { payKindOf, type TransactionCategory } from '../onlymonster/classify';
import {
  attributeAll,
  omSaleId,
  pairKey,
  planPay,
  type ChargebackInput,
  type LedgerSaleInput,
  type StoredOmSale,
} from '../onlymonster/payPlan';
import { ONLYMONSTER_CUTOVER_AT } from '../salary/salaryConstants';
import { addMonths, currentMonthKey, enumerateDays, toDayKey } from '../salary/salaryDate';
import { getDepartures, getFinalizedMonthsFor, getScheduleOccurrences } from './caSalaryService';
import { resolvedFanNames } from './fanRegistryService';
import { announceTierCrossings } from './tierNotices';
import { getOnlyMonsterConfig } from './onlymonsterSyncService';
import { bump, getAllDocs, readTxBuckets, type LedgerContext } from './onlymonsterLedgerService';

const SALES = 'ca-sales';
/** BuddyX stamps a sale 18–55 s earlier than OnlyFans (V14); the window for matching a `bx-*` original. */
const BX_MATCH_WINDOW_MS = 120_000;
const SHADOW_TTL_MS = 60 * 24 * 3600_000;

/** Live writes need both switches; anything less is shadow. */
export async function payTarget(): Promise<{ live: boolean; collection: string; ownFrom: number }> {
  const { salesWriteEnabled } = await getOnlyMonsterConfig();
  const live = salesWriteEnabled && Number.isFinite(ONLYMONSTER_CUTOVER_AT);
  return { live, collection: live ? SALES : COLLECTIONS.salesShadow, ownFrom: live ? ONLYMONSTER_CUTOVER_AT : Number.NEGATIVE_INFINITY };
}

/**
 * A pre-cutover original (`bx-*` / Infloww) by facts — unique match or nothing
 * (§5.5 step 3). Infloww rows carry OnlyFans' own timestamp, so they match on the
 * exact instant; BuddyX runs up to a minute early, so `bx-*` rows match inside
 * `[t − 120 s, t]`. Never guessed.
 */
async function findPreCutoverOriginal(cb: { creatorId: string; category: TransactionCategory; fanId: string; amount: number; transactionAtMs: number }) {
  const kind = payKindOf(cb.category);
  if (!kind) return null;
  const snap = await adminDb
    .collection(SALES)
    .where('creatorId', '==', cb.creatorId)
    .where('kind', '==', kind)
    .where('occurredAt', '>=', Timestamp.fromMillis(cb.transactionAtMs - BX_MATCH_WINDOW_MS))
    .where('occurredAt', '<=', Timestamp.fromMillis(cb.transactionAtMs))
    .select('source', 'fanId', 'grossRevenue', 'occurredAt', 'userId', 'month', 'removedAt', 'status')
    .get();
  const cents = Math.round(Math.abs(cb.amount) * 100);
  const hits = snap.docs.filter(d => {
    if (d.get('removedAt') || d.get('status') === 'reverse') return false;
    if (String(d.get('fanId') ?? '') !== cb.fanId) return false;
    if (Math.round(Number(d.get('grossRevenue')) * 100) !== cents) return false;
    const source = (d.get('source') as string | undefined) ?? 'infloww';
    if (source === 'onlymonster') return false;
    const at = (d.get('occurredAt') as Timestamp).toMillis();
    return source === 'infloww' ? at === cb.transactionAtMs : true;
  });
  if (hits.length !== 1) return null;
  return { saleId: hits[0].id, userId: (hits[0].get('userId') as string | null) ?? null, month: hits[0].get('month') as string };
}

export async function derivePayStage(ctx: LedgerContext & { runId?: string }): Promise<void> {
  const target = await payTarget();
  const start = Math.max(ctx.window.start, target.ownFrom + 1);
  if (start > ctx.now) return; // the cutover is still in the future: nothing is OnlyMonster's yet
  const months: string[] = [];
  for (let m = currentMonthKey(start); m <= currentMonthKey(ctx.now); m = addMonths(m, 1)) months.push(m);
  const days = enumerateDays(toDayKey(start), toDayKey(ctx.now));

  // ── Ledger inputs (removed transactions included: their rows are removed) ──
  // Stage names come with the mapped accounts (the directory stage stores them); buckets
  // come through the run's cache, already filled by the transactions stage.
  const buckets = await readTxBuckets(ctx, ctx.accounts, days);
  const inputs: LedgerSaleInput[] = [];
  for (const acc of ctx.accounts) {
    for (const day of days) {
      for (const [txId, tx] of Object.entries(buckets.get(bucketId(acc.platformAccountId, day)) ?? {})) {
        if (tx.t < start || tx.t > ctx.now || !payKindOf(tx.cat)) continue;
        inputs.push({ platformAccountId: acc.platformAccountId, creatorId: acc.creatorId, creatorName: acc.creatorName, txId, tx });
      }
    }
  }

  // ── Stored om-* rows for the window's months ──
  const stored = new Map<string, StoredOmSale>();
  const monthSnaps = await Promise.all(
    months.map(month =>
      (target.live
        ? adminDb.collection(SALES).where('month', '==', month).where('source', '==', 'onlymonster')
        : adminDb.collection(COLLECTIONS.salesShadow).where('month', '==', month)
      )
        .select('userId', 'month', 'transfer', 'removedAt', 'syncHash', 'vanishedAfterFinalise')
        .get(),
    ),
  );
  for (const [mi, snap] of monthSnaps.entries()) {
    const month = months[mi];
    for (const d of snap.docs) {
      const transfer = d.get('transfer') as { toUserId?: string | null; sourceUserIdAtTransfer?: string | null; fromUserId?: string | null } | null;
      stored.set(d.id, {
        saleId: d.id,
        userId: (d.get('userId') as string | null) ?? null,
        month: (d.get('month') as string) ?? month,
        transfer: transfer ? { toUserId: transfer.toUserId ?? null, sourceUserIdAtTransfer: transfer.sourceUserIdAtTransfer ?? transfer.fromUserId ?? null } : null,
        removed: Boolean(d.get('removedAt')),
        syncHash: (d.get('syncHash') as string | null) ?? null,
        vanishedAfterFinalise: d.get('vanishedAfterFinalise') === true,
      });
    }
  }

  // ── Strict shift attribution ──
  const departures = await getDepartures();
  const occurrences = await getScheduleOccurrences(start, ctx.now);
  const attributions = attributeAll(
    inputs.filter(i => !i.tx.removedAt).map(i => ({ saleId: omSaleId(i.platformAccountId, i.txId), creatorId: i.creatorId, occurredAtMs: i.tx.t })),
    occurrences,
    departures,
  );

  // ── Chargebacks that may need their own row (D17) ──
  const chargebacks: ChargebackInput[] = [];
  const cbSnap = await adminDb
    .collection(COLLECTIONS.chargebacks)
    .where('day', '>=', days[0])
    .where('day', '<=', days[days.length - 1])
    .select('removedAt', 'platformAccountId', 'category', 'transactionAt', 'matchState', 'matchedTxId', 'amount', 'chargebackAt', 'fanId', 'preCutoverSaleId')
    .get();
  const accById = new Map(ctx.accounts.map(a => [a.platformAccountId, a]));
  // A pre-cutover original found once is remembered on the chargeback (`preCutoverSaleId`), so
  // later runs read that one sale for its current holder instead of re-running the fact query.
  const remembered = cbSnap.docs.filter(d => d.get('preCutoverSaleId'));
  const rememberedSales = new Map(
    (await getAllDocs(remembered.map(d => adminDb.collection(SALES).doc(d.get('preCutoverSaleId') as string)))).map(snap => [snap.id, snap]),
  );
  const cbWriter = adminDb.bulkWriter();
  for (const d of cbSnap.docs) {
    if (d.get('removedAt')) continue;
    const acc = accById.get(d.get('platformAccountId') as string);
    if (!acc) continue;
    const category = d.get('category') as TransactionCategory;
    if (!payKindOf(category)) continue;
    const transactionAtMs = (d.get('transactionAt') as Timestamp).toMillis();
    const ownsOriginal = transactionAtMs >= start;
    // An original inside the derivation's window must have matched a ledger row. One before it
    // is a bx-* / Infloww row, matched by the chargeback's own facts whatever its ledger match:
    // OnlyFans usually deletes the original before the ledger ever sees it (V5).
    if (ownsOriginal && d.get('matchState') !== 'matched') continue;
    const base = {
      chargebackId: d.id,
      amount: Number(d.get('amount')),
      category,
      chargebackAtMs: (d.get('chargebackAt') as Timestamp).toMillis(),
      fanId: String(d.get('fanId') ?? ''),
      creatorId: acc.creatorId,
      creatorName: acc.creatorName,
    };
    if (ownsOriginal) {
      chargebacks.push({ ...base, originalSaleId: omSaleId(acc.platformAccountId, String(d.get('matchedTxId'))), preCutoverOriginal: null });
    } else {
      const known = rememberedSales.get(d.get('preCutoverSaleId') as string);
      const original = known?.exists
        ? { saleId: known.id, userId: (known.get('userId') as string | null) ?? null, month: known.get('month') as string }
        : await findPreCutoverOriginal({ creatorId: acc.creatorId, category, fanId: base.fanId, amount: base.amount, transactionAtMs });
      if (original && !known) cbWriter.update(d.ref, { preCutoverSaleId: original.saleId });
      bump(ctx, original ? 'derive.chargebackPreCutoverMatched' : 'derive.chargebackSaleUnmatched');
      if (original) chargebacks.push({ ...base, originalSaleId: null, preCutoverOriginal: original });
    }
  }

  // ── Finalised agent-months ──
  const uids = new Set<string>();
  for (const s of stored.values()) if (s.userId) uids.add(s.userId);
  for (const a of attributions.values()) if (a.sourceUserId) uids.add(a.sourceUserId);
  for (const c of chargebacks) if (c.preCutoverOriginal?.userId) uids.add(c.preCutoverOriginal.userId);
  const cbMonths = chargebacks.map(c => currentMonthKey(c.chargebackAtMs));
  await cbWriter.close();
  const finalized = new Set<string>();
  const finalMonths = [...new Set([...months, ...[...stored.values()].map(s => s.month), ...cbMonths])];
  const perMonth = await Promise.all(finalMonths.map(month => getFinalizedMonthsFor([...uids], month)));
  perMonth.forEach((set, i) => set.forEach(uid => finalized.add(pairKey(uid, finalMonths[i]))));

  const plan = planPay({ inputs, stored, attributions, chargebacks, finalized });
  for (const [k, v] of Object.entries(plan.counts)) ctx.counts[`derive.${k}`] = v;
  ctx.counts['derive.live'] = target.live ? 1 : 0;

  // ── Write ──
  const fanNames = await resolvedFanNames(plan.upserts.map(u => u.sale.fanId));
  const writer = adminDb.bulkWriter();
  const syncedAt = Timestamp.fromMillis(ctx.now);
  for (const { sale, isNew } of plan.upserts) {
    const { occurredAtMs, ...fields } = sale;
    writer.set(
      adminDb.collection(target.collection).doc(sale.saleId),
      {
        ...fields,
        occurredAt: Timestamp.fromMillis(occurredAtMs),
        fanName: fanNames.get(sale.fanId) ?? '',
        // Shape-compatible with every reader of `ca-sales` (CaSaleDocument).
        employeeName: '',
        sourceEmail: '',
        rule: sale.attributedBy === 'schedule' ? 'Agent on shift' : sale.attributedBy === 'chargeback' ? 'Chargeback' : 'Unassigned',
        assignedBy: 'System',
        importId: ctx.runId ?? 'onlymonster',
        syncedAt,
        ...(target.live ? {} : { expireAt: Timestamp.fromMillis(ctx.now + SHADOW_TTL_MS) }),
        // `merge` keeps a transfer and a dispute lock: the plan never names them on an existing row.
        ...(isNew ? { createdAt: FieldValue.serverTimestamp(), transfer: null, disputeId: null } : {}),
      },
      { merge: true },
    );
  }
  for (const saleId of plan.removals) writer.update(adminDb.collection(target.collection).doc(saleId), { removedAt: syncedAt, syncedAt });
  for (const saleId of plan.vanishedFlags) writer.update(adminDb.collection(target.collection).doc(saleId), { vanishedAfterFinalise: true, syncedAt });
  await writer.close();

  if (target.live && plan.touched.size > 0) await announceTierCrossings(plan.touched);
}
