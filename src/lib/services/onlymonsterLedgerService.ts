/**
 * OnlyMonster account ledger and analytics stages (migration plan §4.1, §6, Phase 2).
 *
 * | Stage | Reads (API) | Writes |
 * |---|---|---|
 * | `transactions` | `/transactions` + `/chargebacks` per mapped OnlyFans account, the whole payroll window | `of-transaction-days`, `of-chargebacks` |
 * | `subscriptions` | `/subscriptions`, same window | `of-subscription-days` |
 * | `massMessages` | `/mass-messages`, newest pages back 7 days | `of-mass-messages` |
 * | `metrics` | `/users/metrics` per day (team) and per account-day, today + yesterday | `chatter-days`, `account-activity-days` |
 * | `rollups` | none | `account-days` for every touched account-day |
 * | `reconcile` | `/overview-metrics` per account per open month (21:01 run only) | `account-reconciliation` |
 *
 * **The window is the whole payroll window every run**: from the first day of
 * the oldest month payroll still owes (`resolvePayrollMonth`) to now. Re-reading
 * all of it is what makes vanished-row detection and late status changes
 * correct. Two months of a busy account is ~2 pages at limit 1000.
 *
 * Every write happens only on change. Pages read Firestore, never the API, and
 * nothing here touches `ca-sales` (that is the Phase 3 `derive` stage).
 */
import 'server-only';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '../firebase-admin';
import { omGet, omPaginateCursor, omPaginateOffset } from '../onlymonster/client';
import {
  ACTIVITY_START_DAY,
  COLLECTIONS,
  HISTORY_START_DAY,
  MASS_MESSAGE_LOOKBACK_MS,
} from '../onlymonster/constants';
import { bucketId, mergeWindow, totalsOf, type DayBucket } from '../onlymonster/ledger';
import { matchChargeback } from '../onlymonster/chargebackMatch';
import { categoryOf } from '../onlymonster/classify';
import { isSuspectEmpty } from '../onlymonster/mapping';
import { isStatementsConfigured, statementsGet } from '../onlymonster/statementsClient';
import { normaliseId, type OmChargeback, type OmTransaction } from '../onlymonster/types';
import { ONLYFANS_PLATFORM } from '../creators/accountPlatform';
import { SALARY_TIMEZONE } from '../salary/salaryConstants';
import { round2 } from '../salary/salaryEngine';
import { addDays, addMonths, currentDayKey, dayKeyRange, enumerateDays, monthKeyRange, monthOfDay, toDayKey } from '../salary/salaryDate';
import { resolvePayrollMonth } from './caSalaryService';
import type {
  AccountActivityDayDocument,
  AccountDayDocument,
  OfChargebackDocument,
  OfMassMessageDocument,
  OfSubscriptionDayDocument,
  OfTransactionDayDocument,
} from '@/types/firestore';

// ─── Context ─────────────────────────────────────────────────────────

export interface MappedAccount {
  accountId: string;
  platformAccountId: string;
  creatorId: string;
  /** The Bluu stage name the directory stage resolved (stored on `onlymonster-accounts`). */
  creatorName: string;
  /** Where this account's OnlyMonster history starts, once known. */
  firstTxDay: string | null;
}

export interface LedgerContext {
  now: number;
  deadline: number;
  window: { start: number; end: number };
  accounts: MappedAccount[];
  /** platformAccountId → salary days whose rollup must be recomputed. */
  touched: Map<string, Set<string>>;
  counts: Record<string, number>;
  warnings: string[];
  /**
   * Per-run cache of `of-transaction-days` buckets by doc id. The transactions stage fills
   * it with what it just merged, so rollups, the fan rollup and the pay derivation in the
   * same run read the window once instead of three or four times.
   */
  buckets?: Map<string, DayBucket>;
  /** `onlymonster-members` → uid, read once per run (`memberUids`). */
  memberUid?: Map<string, string | null>;
}

export class BudgetExceeded extends Error {
  constructor() {
    super('time budget exhausted');
  }
}

function checkBudget(ctx: LedgerContext): void {
  if (Date.now() > ctx.deadline) throw new BudgetExceeded();
}

export function bump(ctx: LedgerContext, key: string, by = 1): void {
  ctx.counts[key] = (ctx.counts[key] ?? 0) + by;
}

function touch(ctx: LedgerContext, platformAccountId: string, days: Iterable<string>): void {
  let set = ctx.touched.get(platformAccountId);
  if (!set) ctx.touched.set(platformAccountId, (set = new Set()));
  for (const d of days) set.add(d);
}

/**
 * Mapped OnlyFans accounts only. OnlyMonster accounts with no Bluu match are
 * ignored for now (decision 2026-11-11) and Fansly accounts are never synced.
 */
export async function loadMappedAccounts(): Promise<MappedAccount[]> {
  const snap = await adminDb
    .collection(COLLECTIONS.accounts)
    .where('platform', '==', ONLYFANS_PLATFORM)
    .select('accountId', 'platformAccountId', 'creatorId', 'creatorName', 'listed', 'firstTxDay')
    .get();
  return snap.docs
    .filter(d => d.get('creatorId') && d.get('listed') !== false)
    .map(d => ({
      accountId: d.get('accountId') as string,
      platformAccountId: d.get('platformAccountId') as string,
      creatorId: d.get('creatorId') as string,
      creatorName: (d.get('creatorName') as string | null) ?? '',
      firstTxDay: (d.get('firstTxDay') as string | undefined) ?? null,
    }));
}

/** Accounts grouped by the Bluu account they map to (several only by manual link). */
export function groupByCreator(accounts: MappedAccount[]): Map<string, MappedAccount[]> {
  const out = new Map<string, MappedAccount[]>();
  for (const acc of accounts) {
    const list = out.get(acc.creatorId);
    if (list) list.push(acc);
    else out.set(acc.creatorId, [acc]);
  }
  return out;
}

/** Run `fn` for every mapped account, checking the time budget before each. */
async function forEachAccount(ctx: LedgerContext, fn: (acc: MappedAccount) => Promise<void>): Promise<void> {
  for (const acc of ctx.accounts) {
    checkBudget(ctx);
    await fn(acc);
  }
}

/** Member → uid, read once per run. */
export async function memberUids(ctx: LedgerContext): Promise<Map<string, string | null>> {
  if (!ctx.memberUid) ctx.memberUid = await loadMemberUids();
  return ctx.memberUid;
}

/** The payroll window: the first instant of the oldest open payroll month → now. */
export async function payrollWindow(now: number): Promise<{ start: number; end: number }> {
  const month = await resolvePayrollMonth(now);
  return { start: monthKeyRange(month)[0], end: now };
}

/** `getAll` in slices, so a long day range never builds one oversized RPC. */
export async function getAllDocs(refs: FirebaseFirestore.DocumentReference[]) {
  const out: FirebaseFirestore.DocumentSnapshot[] = [];
  for (let i = 0; i < refs.length; i += 300) out.push(...(await adminDb.getAll(...refs.slice(i, i + 300))));
  return out;
}

/** The account × day bucket refs of one collection, in account-major order. */
export function bucketRefs(col: string, accs: MappedAccount[], days: string[]) {
  return accs.flatMap(a => days.map(d => adminDb.collection(col).doc(bucketId(a.platformAccountId, d))));
}

/**
 * The transaction buckets for these accounts and days, keyed by bucket id, through the
 * per-run cache: only buckets this run has not seen are read.
 */
export async function readTxBuckets(ctx: LedgerContext, accs: MappedAccount[], days: string[]): Promise<Map<string, DayBucket>> {
  const cache = (ctx.buckets ??= new Map());
  const missing = bucketRefs(COLLECTIONS.txDays, accs, days).filter(r => !cache.has(r.id));
  for (const [i, snap] of (await getAllDocs(missing)).entries()) {
    cache.set(missing[i].id, snap.exists ? ((snap.data() as OfTransactionDayDocument).txs ?? {}) : {});
  }
  const out = new Map<string, DayBucket>();
  for (const a of accs) for (const d of days) out.set(bucketId(a.platformAccountId, d), cache.get(bucketId(a.platformAccountId, d)) ?? {});
  return out;
}

const iso = (ms: number) => new Date(ms).toISOString();

// ─── transactions + chargebacks ──────────────────────────────────────

/**
 * One account, one window: fetch, merge into the day buckets, match
 * chargebacks, write what changed. Used by the scheduled stage and by the
 * backfill (one month at a time).
 */
export async function syncAccountLedger(ctx: LedgerContext, acc: MappedAccount, start: number, end: number): Promise<void> {
  const base = `/api/v0/platforms/onlyfans/accounts/${acc.platformAccountId}`;
  // An exception mid-pagination propagates: an incomplete window must never vanish rows.
  const fetched = await omPaginateCursor<OmTransaction>(`${base}/transactions`, { start: iso(start), end: iso(end), limit: 1000 });
  const chargebacks = await omPaginateCursor<OmChargeback>(`${base}/chargebacks`, { start: iso(start), end: iso(end), limit: 1000 });
  bump(ctx, 'transactions.fetched', fetched.length);
  bump(ctx, 'chargebacks.fetched', chargebacks.length);

  // Every bucket the window touches, plus the buckets the chargebacks' originals live in.
  const days = new Set(enumerateDays(toDayKey(start), toDayKey(end)));
  for (const cb of chargebacks) {
    const t = Date.parse(cb.transaction_timestamp);
    if (Number.isFinite(t)) days.add(toDayKey(t));
  }
  const dayList = [...days];
  const cached = await readTxBuckets(ctx, [acc], dayList);
  const stored = new Map<string, DayBucket>();
  for (const d of dayList) {
    const bucket = cached.get(bucketId(acc.platformAccountId, d))!;
    if (Object.keys(bucket).length) stored.set(d, bucket);
  }

  let merged = mergeWindow({ fetched, stored, windowStart: start, windowEnd: end, complete: true, dayOf: toDayKey, now: ctx.now });
  // Vanishing removes pay rows, so it is never trusted on a suspicious answer: an empty
  // list while live rows are stored (the probe once got an empty list that was not), or
  // more than half of an account's live rows disappearing in one run. Nothing vanishes,
  // a warning says so, and the next run decides again.
  let liveInWindow = 0;
  for (const bucket of stored.values()) for (const row of Object.values(bucket)) if (!row.removedAt && row.t >= start && row.t <= end) liveInWindow += 1;
  const suspect = isSuspectEmpty(fetched.length, liveInWindow) || (merged.counts.vanished > 5 && merged.counts.vanished > liveInWindow / 2);
  if (suspect) {
    ctx.warnings.push(
      `Account ${acc.accountId}: /transactions would vanish ${merged.counts.vanished} of ${liveInWindow} stored rows (${fetched.length} returned); vanishing held this run.`,
    );
    bump(ctx, 'transactions.vanishHeld');
    merged = mergeWindow({ fetched, stored, windowStart: start, windowEnd: end, complete: false, dayOf: toDayKey, now: ctx.now });
  }
  for (const [k, v] of Object.entries(merged.counts)) bump(ctx, `transactions.${k}`, v);
  const current = new Map(stored);
  for (const [day, bucket] of merged.changed) current.set(day, bucket);
  const changedDays = new Set(merged.changed.keys());

  // ── Chargebacks: unique-match each to its original (§5.5) ──
  const cbRefs = chargebacks.map(cb => adminDb.collection(COLLECTIONS.chargebacks).doc(String(cb.id)));
  // The window query finds the stored chargebacks (and the vanished ones); only ids it does
  // not hold are read by id, so a chargeback is never read twice.
  const storedCbs = await adminDb
    .collection(COLLECTIONS.chargebacks)
    .where('platformAccountId', '==', acc.platformAccountId)
    .where('chargebackAt', '>=', Timestamp.fromMillis(start))
    .where('chargebackAt', '<=', Timestamp.fromMillis(end))
    .get();
  const storedById = new Map(storedCbs.docs.map(d => [d.id, d as FirebaseFirestore.DocumentSnapshot]));
  const missingCbRefs = cbRefs.filter(r => !storedById.has(r.id));
  for (const [i, snap] of (await getAllDocs(missingCbRefs)).entries()) storedById.set(missingCbRefs[i].id, snap);
  const cbSnaps = cbRefs.map(r => storedById.get(r.id)!);
  const writer = adminDb.bulkWriter();
  const seenCb = new Set<string>();
  const cbDays = new Set<string>();

  chargebacks.forEach((cb, i) => {
    const id = normaliseId(cb.id);
    const transactionAtMs = Date.parse(cb.transaction_timestamp);
    const chargebackAtMs = Date.parse(cb.chargeback_timestamp);
    if (!id || !Number.isFinite(transactionAtMs) || !Number.isFinite(chargebackAtMs)) return;
    seenCb.add(id);
    const txDay = toDayKey(transactionAtMs);
    const fanId = normaliseId(cb.fan?.id) ?? '';
    const match = matchChargeback({ fanId, type: cb.type, amount: cb.amount, transactionAtMs }, current.get(txDay));
    bump(ctx, `chargebacks.${match.state}`);
    if (match.state === 'matched') {
      const bucket = { ...current.get(txDay)! };
      const row = bucket[match.txId!];
      if (row.chargebackId !== id || !row.chargedBackAt) {
        bucket[match.txId!] = { ...row, chargedBackAt: chargebackAtMs, chargebackId: id };
        current.set(txDay, bucket);
        changedDays.add(txDay);
      }
    }
    const day = toDayKey(chargebackAtMs);
    cbDays.add(day);
    const prev = cbSnaps[i].exists ? (cbSnaps[i].data() as OfChargebackDocument) : undefined;
    const next = {
      chargebackId: id,
      accountId: acc.accountId,
      platformAccountId: acc.platformAccountId,
      creatorId: acc.creatorId,
      fanId,
      type: cb.type,
      category: categoryOf(cb.type),
      status: cb.status,
      amount: cb.amount,
      chargebackAt: Timestamp.fromMillis(chargebackAtMs),
      transactionAt: Timestamp.fromMillis(transactionAtMs),
      day,
      month: monthOfDay(day),
      matchState: match.state,
      matchedTxId: match.txId,
      removedAt: null,
    };
    const differs =
      !prev ||
      prev.status !== next.status ||
      prev.amount !== next.amount ||
      prev.matchState !== next.matchState ||
      prev.matchedTxId !== next.matchedTxId ||
      prev.creatorId !== next.creatorId ||
      prev.removedAt;
    if (differs) {
      writer.set(cbRefs[i], { ...next, syncedAt: FieldValue.serverTimestamp() });
      bump(ctx, 'chargebacks.written');
    }
  });
  // A chargeback OnlyMonster stops returning inside a complete window is soft-removed —
  // but never on an empty answer while chargebacks are stored (same guard as above).
  const cbSuspect = isSuspectEmpty(chargebacks.length, storedCbs.docs.filter(d => !d.get('removedAt')).length);
  if (cbSuspect) ctx.warnings.push(`Account ${acc.accountId}: /chargebacks returned none while some are stored; vanishing held this run.`);
  for (const doc of cbSuspect ? [] : storedCbs.docs) {
    if (seenCb.has(doc.id) || doc.get('removedAt')) continue;
    writer.update(doc.ref, { removedAt: FieldValue.serverTimestamp() });
    cbDays.add(doc.get('day') as string);
    bump(ctx, 'chargebacks.vanished');
  }

  // ── Write changed buckets ──
  for (const day of changedDays) {
    const doc: Omit<OfTransactionDayDocument, 'syncedAt'> = {
      accountId: acc.accountId,
      platformAccountId: acc.platformAccountId,
      creatorId: acc.creatorId,
      day,
      month: monthOfDay(day),
      txs: current.get(day) ?? {},
    };
    writer.set(adminDb.collection(COLLECTIONS.txDays).doc(bucketId(acc.platformAccountId, day)), { ...doc, syncedAt: FieldValue.serverTimestamp() });
  }
  await writer.close();
  bump(ctx, 'transactions.bucketsWritten', changedDays.size);
  touch(ctx, acc.platformAccountId, [...changedDays, ...cbDays]);
  // Later stages of this run read the merged buckets from the cache.
  for (const day of changedDays) ctx.buckets!.set(bucketId(acc.platformAccountId, day), current.get(day) ?? {});

  // The first day this account has any transaction: where its OnlyMonster history starts (V6).
  // Written only when it moves earlier, which is almost never after the backfill.
  const firstDay = [...current].filter(([, b]) => Object.keys(b).length > 0).map(([d]) => d).sort()[0];
  if (firstDay && (!acc.firstTxDay || firstDay < acc.firstTxDay)) {
    await recordFirstTxDay(acc.accountId, firstDay);
    acc.firstTxDay = firstDay;
  }
}

async function recordFirstTxDay(accountId: string, day: string): Promise<void> {
  const ref = adminDb.collection(COLLECTIONS.accounts).doc(accountId);
  await adminDb.runTransaction(async tx => {
    const snap = await tx.get(ref);
    const prev = snap.get('firstTxDay') as string | undefined;
    if (!prev || day < prev) tx.update(ref, { firstTxDay: day });
  });
}

export async function syncTransactionsStage(ctx: LedgerContext): Promise<void> {
  await forEachAccount(ctx, acc => syncAccountLedger(ctx, acc, ctx.window.start, ctx.window.end));
}

// ─── subscriptions ───────────────────────────────────────────────────

interface OmSubscription {
  fan: { id: string };
  price_gross: number;
  regular_price_gross: number;
  action: string;
  type: string;
  subscribed_at: string;
  expires_at: string;
}

export async function syncAccountSubscriptions(ctx: LedgerContext, acc: MappedAccount, start: number, end: number): Promise<void> {
  const items = await omPaginateCursor<OmSubscription>(
    `/api/v0/platforms/onlyfans/accounts/${acc.platformAccountId}/subscriptions`,
    { start: iso(start), end: iso(end), limit: 1000 },
  );
  bump(ctx, 'subscriptions.fetched', items.length);
  const byDay = new Map<string, OfSubscriptionDayDocument['subs']>();
  for (const s of items) {
    const at = Date.parse(s.subscribed_at);
    const fan = normaliseId(s.fan?.id);
    if (!Number.isFinite(at) || !fan) continue;
    const day = toDayKey(at);
    const subs = byDay.get(day) ?? {};
    subs[`${fan}_${at}`] = { action: String(s.action ?? ''), type: String(s.type ?? ''), price: Number(s.price_gross) || 0, regular: Number(s.regular_price_gross) || 0 };
    byDay.set(day, subs);
  }
  if (byDay.size === 0) return;
  const days = [...byDay.keys()];
  const refs = days.map(d => adminDb.collection(COLLECTIONS.subDays).doc(bucketId(acc.platformAccountId, d)));
  const snaps = await getAllDocs(refs);
  const writer = adminDb.bulkWriter();
  const changed: string[] = [];
  snaps.forEach((snap, i) => {
    const prev = snap.exists ? ((snap.data() as OfSubscriptionDayDocument).subs ?? {}) : {};
    const next = { ...prev, ...byDay.get(days[i])! };
    if (JSON.stringify(Object.entries(prev).sort()) === JSON.stringify(Object.entries(next).sort())) return;
    writer.set(refs[i], {
      accountId: acc.accountId,
      platformAccountId: acc.platformAccountId,
      creatorId: acc.creatorId,
      day: days[i],
      subs: next,
      syncedAt: FieldValue.serverTimestamp(),
    });
    changed.push(days[i]);
  });
  await writer.close();
  bump(ctx, 'subscriptions.bucketsWritten', changed.length);
  touch(ctx, acc.platformAccountId, changed);
}

export async function syncSubscriptionsStage(ctx: LedgerContext): Promise<void> {
  await forEachAccount(ctx, acc => syncAccountSubscriptions(ctx, acc, ctx.window.start, ctx.window.end));
}

// ─── mass messages ───────────────────────────────────────────────────

interface OmMassMessage {
  id: string;
  status: string;
  created_at: string;
  created_by: { type: 'user' | 'api_key'; id: string } | null;
  message: { price_gross: number | null };
  stats: { sent_messages_count: number; viewed_messages_count: number; purchased_messages_count: number; purchased_amount_gross: number };
}

/**
 * Newest first, cursor `to` = the last item's `created_at` (one-second
 * precision, so dedupe by id). Stops once a page reaches `since`; `since: 0`
 * walks the whole history (the backfill).
 */
export async function syncAccountMassMessages(ctx: LedgerContext, acc: MappedAccount, since: number, memberUid: Map<string, string | null>): Promise<void> {
  const path = `/api/v0/accounts/${acc.accountId}/mass-messages`;
  const seen = new Map<string, OmMassMessage>();
  let to: string | undefined;
  for (let page = 0; page < 200; page++) {
    const body = await omGet<{ items: OmMassMessage[]; has_more: boolean }>(path, { limit: 100, to });
    const items = body.items ?? [];
    for (const m of items) seen.set(m.id, m);
    const oldest = items.filter(m => m.status === 'done' || m.status === 'unsent').at(-1);
    if (!body.has_more || !oldest || Date.parse(oldest.created_at) < since) break;
    if (to === oldest.created_at) break; // a page of identical timestamps cannot advance
    to = oldest.created_at;
  }
  bump(ctx, 'massMessages.fetched', seen.size);
  if (seen.size === 0) return;
  const list = [...seen.values()];
  const refs = list.map(m => adminDb.collection(COLLECTIONS.massMessages).doc(String(m.id)));
  const snaps = await getAllDocs(refs);
  const writer = adminDb.bulkWriter();
  const days = new Set<string>();
  list.forEach((m, i) => {
    const createdAt = Date.parse(m.created_at);
    if (!Number.isFinite(createdAt)) return;
    const day = toDayKey(createdAt);
    const createdById = m.created_by?.id ?? null;
    const next = {
      id: String(m.id),
      accountId: acc.accountId,
      creatorId: acc.creatorId,
      createdAt: Timestamp.fromMillis(createdAt),
      day,
      status: m.status,
      priceGross: m.message?.price_gross ?? null,
      sent: m.stats?.sent_messages_count ?? 0,
      viewed: m.stats?.viewed_messages_count ?? 0,
      purchased: m.stats?.purchased_messages_count ?? 0,
      purchasedGross: m.stats?.purchased_amount_gross ?? 0,
      createdByType: m.created_by?.type ?? null,
      createdById,
      uid: m.created_by?.type === 'user' && createdById ? memberUid.get(createdById) ?? null : null,
    };
    const prev = snaps[i].exists ? (snaps[i].data() as OfMassMessageDocument) : undefined;
    const keys = ['status', 'priceGross', 'sent', 'viewed', 'purchased', 'purchasedGross', 'uid', 'creatorId'] as const;
    if (prev && keys.every(k => (prev[k] ?? null) === (next[k] ?? null))) return;
    writer.set(refs[i], { ...next, syncedAt: FieldValue.serverTimestamp() });
    days.add(day);
  });
  await writer.close();
  bump(ctx, 'massMessages.written', days.size);
  touch(ctx, acc.platformAccountId, days);
}

export async function loadMemberUids(): Promise<Map<string, string | null>> {
  const snap = await adminDb.collection(COLLECTIONS.members).select('uid').get();
  return new Map(snap.docs.map(d => [d.id, (d.get('uid') as string | null) ?? null]));
}

export async function syncMassMessagesStage(ctx: LedgerContext): Promise<void> {
  const memberUid = await memberUids(ctx);
  await forEachAccount(ctx, acc => syncAccountMassMessages(ctx, acc, ctx.now - MASS_MESSAGE_LOOKBACK_MS, memberUid));
}

// ─── metrics (/users/metrics) ────────────────────────────────────────

interface OmUserMetrics {
  user_id: number;
  creator_ids: number[];
  chats_count?: number;
  messages_count?: number;
  paid_messages_count?: number;
  sold_messages_count?: number;
  sold_messages_price_sum?: number;
  tips_amount_sum?: number;
  words_count_sum?: number;
  typed_messages_count?: number;
  reply_time_avg?: number;
  work_time?: number;
}

function weightedReplyMs(rows: OmUserMetrics[]): number | null {
  let w = 0;
  let s = 0;
  for (const r of rows) {
    if (typeof r.reply_time_avg !== 'number' || !(r.messages_count && r.messages_count > 0)) continue;
    w += r.messages_count;
    s += r.reply_time_avg * r.messages_count;
  }
  return w > 0 ? Math.round((s / w) * 1000) : null;
}

/** One salary day of activity: the team (`chatter-days`) and every account (`account-activity-days`). */
export async function syncMetricsDay(ctx: LedgerContext, day: string, memberUid: Map<string, string | null>): Promise<void> {
  if (day < ACTIVITY_START_DAY) return;
  const [startMs, endMs] = dayKeyRange(day);
  const window = { from: iso(startMs), to: iso(Math.min(endMs, ctx.now)) };

  const team = await omPaginateOffset<OmUserMetrics>('/api/v0/users/metrics', window, 'items', 100);
  const rows: Record<string, unknown> = {};
  for (const r of team) {
    const id = normaliseId(r.user_id);
    if (!id) continue;
    rows[id] = {
      uid: memberUid.get(id) ?? null,
      chats: r.chats_count ?? 0,
      messages: r.messages_count ?? 0,
      ppvsSent: r.paid_messages_count ?? 0,
      ppvsSold: r.sold_messages_count ?? 0,
      soldGross: round2(r.sold_messages_price_sum ?? 0),
      tipsGross: round2(r.tips_amount_sum ?? 0),
      typedWords: r.words_count_sum ?? 0,
      typedMessages: r.typed_messages_count ?? 0,
      replyTimeAvgMs: typeof r.reply_time_avg === 'number' ? Math.round(r.reply_time_avg * 1000) : null,
      workTimeS: typeof r.work_time === 'number' ? r.work_time : null,
    };
  }
  // Written, and the day marked for rollup, only when something changed: otherwise every
  // run would rebuild every creator's current month for nothing.
  const activityRefs = bucketRefs(COLLECTIONS.activityDays, ctx.accounts, [day]);
  const [chatterSnap, ...activitySnaps] = await getAllDocs([adminDb.collection(COLLECTIONS.chatterDays).doc(day), ...activityRefs]);
  const writer = adminDb.bulkWriter();
  if (JSON.stringify(chatterSnap.get('rows') ?? null) !== JSON.stringify(rows)) {
    writer.set(chatterSnap.ref, { day, source: 'onlymonster', rows, syncedAt: FieldValue.serverTimestamp() });
  }
  for (const [i, acc] of ctx.accounts.entries()) {
    const per = await omPaginateOffset<OmUserMetrics>('/api/v0/users/metrics', { ...window, creator_ids: [Number(acc.accountId)] }, 'items', 100);
    const next: Omit<AccountActivityDayDocument, 'syncedAt'> = { creatorId: acc.creatorId, day, fansChatted: 0, messagesSent: 0, ppvsSent: 0, ppvsUnlocked: 0, replyTimeAvgMs: weightedReplyMs(per) };
    for (const r of per) {
      next.fansChatted += r.chats_count ?? 0;
      next.messagesSent += r.messages_count ?? 0;
      next.ppvsSent += r.paid_messages_count ?? 0;
      next.ppvsUnlocked += r.sold_messages_count ?? 0;
    }
    const prev = activitySnaps[i].data();
    const keys = ['creatorId', 'fansChatted', 'messagesSent', 'ppvsSent', 'ppvsUnlocked', 'replyTimeAvgMs'] as const;
    if (prev && keys.every(k => prev[k] === next[k])) continue;
    writer.set(activityRefs[i], { ...next, syncedAt: FieldValue.serverTimestamp() });
    touch(ctx, acc.platformAccountId, [day]);
  }
  await writer.close();
  bump(ctx, 'metrics.days');
}

export async function syncMetricsStage(ctx: LedgerContext): Promise<void> {
  const memberUid = await memberUids(ctx);
  const today = currentDayKey(ctx.now);
  for (const day of [addDays(today, -1), today]) {
    checkBudget(ctx);
    await syncMetricsDay(ctx, day, memberUid);
  }
}

// ─── rollups → account-days ──────────────────────────────────────────

/**
 * Recompute `account-days` for every touched account-day, from scratch. Several
 * OnlyMonster accounts mapped to one Bluu account (only possible by manual link)
 * are summed into its one document.
 */
export async function rollupTouched(ctx: LedgerContext): Promise<void> {
  const byCreator = groupByCreator(ctx.accounts);

  const work = new Map<string, Set<string>>(); // creatorId → days
  for (const acc of ctx.accounts) {
    const days = ctx.touched.get(acc.platformAccountId);
    if (!days?.size) continue;
    const set = work.get(acc.creatorId) ?? new Set();
    for (const d of days) set.add(d);
    work.set(acc.creatorId, set);
  }

  const writer = adminDb.bulkWriter();
  let written = 0;
  for (const [creatorId, daySet] of work) {
    checkBudget(ctx);
    const days = [...daySet].sort();
    const accs = byCreator.get(creatorId)!;
    const from = days[0];
    const to = days[days.length - 1];
    const [tx, subSnaps, actSnaps, cbSnap, mmSnap] = await Promise.all([
      readTxBuckets(ctx, accs, days),
      getAllDocs(bucketRefs(COLLECTIONS.subDays, accs, days)),
      getAllDocs(bucketRefs(COLLECTIONS.activityDays, accs, days)),
      adminDb.collection(COLLECTIONS.chargebacks).where('creatorId', '==', creatorId).where('day', '>=', from).where('day', '<=', to)
        .select('day', 'amount', 'removedAt').get(),
      adminDb.collection(COLLECTIONS.massMessages).where('creatorId', '==', creatorId).where('day', '>=', from).where('day', '<=', to).select('day', 'status').get(),
    ]);
    // The bucket refs are account-major, so a snapshot's day is its index modulo the day count.
    const dayIndex = new Map(days.map((d, i) => [d, i]));
    const at = (snaps: FirebaseFirestore.DocumentSnapshot[], day: string) =>
      accs.map((_, a) => snaps[a * days.length + dayIndex.get(day)!]).filter(s => s.exists);
    const cbsByDay = new Map<string, FirebaseFirestore.QueryDocumentSnapshot[]>();
    for (const d of cbSnap.docs) if (!d.get('removedAt')) cbsByDay.set(d.get('day'), [...(cbsByDay.get(d.get('day')) ?? []), d]);
    const massByDay = new Map<string, number>();
    for (const d of mmSnap.docs) if (d.get('status') !== 'unsent') massByDay.set(d.get('day'), (massByDay.get(d.get('day')) ?? 0) + 1);

    for (const day of days) {
      const bucket: DayBucket = Object.assign({}, ...accs.map(a => tx.get(bucketId(a.platformAccountId, day)) ?? {}));
      const subList = at(subSnaps, day).flatMap(snap => Object.values((snap.get('subs') ?? {}) as OfSubscriptionDayDocument['subs']));
      let act: Pick<AccountActivityDayDocument, 'fansChatted' | 'messagesSent' | 'ppvsSent' | 'ppvsUnlocked' | 'replyTimeAvgMs'> | null = null;
      for (const snap of at(actSnaps, day)) {
        const a = snap.data() as AccountActivityDayDocument;
        if (!act) act = { fansChatted: a.fansChatted, messagesSent: a.messagesSent, ppvsSent: a.ppvsSent, ppvsUnlocked: a.ppvsUnlocked, replyTimeAvgMs: a.replyTimeAvgMs };
        else {
          act.fansChatted += a.fansChatted;
          act.messagesSent += a.messagesSent;
          act.ppvsSent += a.ppvsSent;
          act.ppvsUnlocked += a.ppvsUnlocked;
          act.replyTimeAvgMs ??= a.replyTimeAvgMs;
        }
      }
      const cbs = cbsByDay.get(day) ?? [];
      const doc: Omit<AccountDayDocument, 'syncedAt'> = {
        creatorId,
        day,
        source: 'onlymonster',
        tz: SALARY_TIMEZONE,
        ...totalsOf(bucket),
        // Subscriptions include free trials, unlike transactions.
        newSubs: subList.filter(s => s.action === 'subscribe').length,
        returningSubs: subList.filter(s => s.action === 'return').length,
        trialSubs: subList.filter(s => s.type.includes('trial')).length,
        chargebacks: cbs.length,
        chargebackGross: round2(cbs.reduce((s, d) => s + (Number(d.get('amount')) || 0), 0)),
        fansChatted: act?.fansChatted ?? null,
        messagesSent: act?.messagesSent ?? null,
        ppvsSent: act?.ppvsSent ?? null,
        ppvsUnlocked: act?.ppvsUnlocked ?? null,
        replyTimeMs: act?.replyTimeAvgMs ?? null,
        massMessages: massByDay.get(day) ?? 0,
      };
      writer.set(adminDb.collection(COLLECTIONS.accountDays).doc(`${creatorId}_${day}`), { ...doc, syncedAt: FieldValue.serverTimestamp() });
      written += 1;
    }
  }
  await writer.close();
  bump(ctx, 'rollups.accountDays', written);
  // The fan rollup follows the same touched months.
  for (const [creatorId, daySet] of work) {
    const months = [...new Set([...daySet].map(monthOfDay))].sort();
    await rollupCreatorFans(ctx, creatorId, byCreator.get(creatorId)!, months);
  }
  ctx.touched.clear();
}

// ─── reconcile (/overview-metrics) ───────────────────────────────────

/** `+02:00` bounds for a month: OnlyFans Analytics and pay both bucket on Africa/Harare. */
function harareBounds(month: string, now: number): { from: string; to: string } {
  const [startMs, endMs] = monthKeyRange(month);
  const fmt = (ms: number) => new Date(ms + 2 * 3600_000).toISOString().replace('Z', '+02:00');
  return { from: fmt(startMs), to: fmt(Math.min(endMs, now)) };
}

export async function reconcileStage(ctx: LedgerContext): Promise<void> {
  const months: string[] = [];
  for (let m = monthOfDay(toDayKey(ctx.window.start)); m <= monthOfDay(currentDayKey(ctx.now)); m = addMonths(m, 1)) months.push(m);
  const byCreator = groupByCreator(ctx.accounts);

  const writer = adminDb.bulkWriter();
  for (const [creatorId, accs] of byCreator) {
    for (const month of months) {
      checkBudget(ctx);
      const bounds = harareBounds(month, ctx.now);
      let omGross = 0;
      let omNet = 0;
      for (const acc of accs) {
        const path = `/api/v0/platforms/onlyfans/accounts/${acc.platformAccountId}/overview-metrics`;
        const [net, gross] = await Promise.all([
          omGet<{ total_revenue: number }>(path, { ...bounds, earnings_type: 'net', include_subscription_revenue: true }),
          omGet<{ total_revenue: number }>(path, { ...bounds, earnings_type: 'gross', include_subscription_revenue: true }),
        ]);
        omGross += gross.total_revenue ?? 0;
        omNet += net.total_revenue ?? 0;
      }
      const [first, last] = [`${month}-01`, `${month}-31`];
      const snap = await adminDb
        .collection(COLLECTIONS.accountDays)
        .where('creatorId', '==', creatorId)
        .where('day', '>=', first)
        .where('day', '<=', last)
        .select('totalGross', 'totalNet')
        .get();
      const ledgerGross = round2(snap.docs.reduce((s, d) => s + (Number(d.get('totalGross')) || 0), 0));
      const ledgerNet = round2(snap.docs.reduce((s, d) => s + (Number(d.get('totalNet')) || 0), 0));
      writer.set(adminDb.collection(COLLECTIONS.reconciliation).doc(`${creatorId}_${month}`), {
        creatorId,
        month,
        om: { gross: round2(omGross), net: round2(omNet) },
        ledger: { gross: ledgerGross, net: ledgerNet },
        diff: { gross: round2(omGross - ledgerGross), net: round2(omNet - ledgerNet) },
        checkedAt: FieldValue.serverTimestamp(),
      });
      bump(ctx, 'reconcile.checked');
      if (Math.abs(omNet - ledgerNet) >= 0.01) bump(ctx, 'reconcile.differs');
    }
  }
  await writer.close();
}

// ─── backfill (advanced by the continuation cron) ────────────────────

export type BackfillJob =
  | { kind: 'ledger'; accountId: string; month: string }
  | { kind: 'mass'; accountId: string }
  | { kind: 'metrics'; day: string };

/**
 * The backfill, as an ordered list of small jobs (D9): every mapped account's
 * transactions, chargebacks and subscriptions month by month from 2025-10-04
 * up to the payroll window, every account's mass-message history, and
 * activity days from 2026-11-01 (all OnlyMonster has). It writes the account
 * ledger and rollups **only**, never `ca-sales`.
 */
export function backfillJobs(accounts: MappedAccount[], windowStart: number): BackfillJob[] {
  const jobs: BackfillJob[] = [];
  const lastMonth = addMonths(monthOfDay(toDayKey(windowStart)), -1);
  for (const acc of accounts) {
    for (let m = monthOfDay(HISTORY_START_DAY); m <= lastMonth; m = addMonths(m, 1)) jobs.push({ kind: 'ledger', accountId: acc.accountId, month: m });
    jobs.push({ kind: 'mass', accountId: acc.accountId });
  }
  const lastDay = addDays(toDayKey(windowStart), -1);
  if (lastDay >= ACTIVITY_START_DAY) for (const day of enumerateDays(ACTIVITY_START_DAY, lastDay)) jobs.push({ kind: 'metrics', day });
  return jobs;
}

export async function runBackfillJob(ctx: LedgerContext, job: BackfillJob, memberUid: Map<string, string | null>): Promise<void> {
  if (job.kind === 'metrics') {
    await syncMetricsDay(ctx, job.day, memberUid);
    return;
  }
  const acc = ctx.accounts.find(a => a.accountId === job.accountId);
  if (!acc) return; // unmapped since the list was built: skip
  if (job.kind === 'mass') {
    await syncAccountMassMessages(ctx, acc, 0, memberUid);
    return;
  }
  const [monthStart, monthEnd] = monthKeyRange(job.month);
  const start = Math.max(monthStart, dayKeyRange(HISTORY_START_DAY)[0]);
  await syncAccountLedger(ctx, acc, start, monthEnd);
  await syncAccountSubscriptions(ctx, acc, start, monthEnd);
}

// ─── creator-fans (plan §6.2) ────────────────────────────────────────

type FanMonth = { tips: number; ppv: number; subs: number; other: number; count: number; first: number | null; last: number | null };
type FanSubMonth = { n: number; lastAt: number | null; lastType: string | null; isTrial: boolean };

/**
 * Rebuild `creator-fans/{creatorId}_{fanId}.spendByMonth[month]` from the account
 * ledger — every category, subscriptions included, with the tips / PPV split kept
 * (the shape of `buddyx-fans`, so Fan Analytics only swaps the collection).
 *
 * A digest per creator-month (`creator-fan-months`, fan → hash) means a run reads
 * one doc and writes **only fans whose month changed**; only those fans' docs are
 * read, to recompute their lifetime subscription summary.
 */
export async function rollupCreatorFans(ctx: LedgerContext, creatorId: string, accs: MappedAccount[], months: string[]): Promise<void> {
  for (const month of months) {
    checkBudget(ctx);
    const [mStart, mEnd] = monthKeyRange(month);
    const days = enumerateDays(toDayKey(mStart), toDayKey(mEnd));
    const digestRef = adminDb.collection('creator-fan-months').doc(`${creatorId}_${month}`);
    const [tx, subSnaps, digestSnap] = await Promise.all([readTxBuckets(ctx, accs, days), getAllDocs(bucketRefs(COLLECTIONS.subDays, accs, days)), digestRef.get()]);

    const spend = new Map<string, FanMonth>();
    for (const bucket of tx.values()) {
      for (const row of Object.values(bucket)) {
        if (row.removedAt || !row.fan || !(row.gross && row.gross > 0)) continue;
        const f = spend.get(row.fan) ?? { tips: 0, ppv: 0, subs: 0, other: 0, count: 0, first: null, last: null };
        if (row.cat === 'tip') f.tips = round2(f.tips + row.gross);
        else if (row.cat === 'message') f.ppv = round2(f.ppv + row.gross);
        else if (row.cat === 'subscription' || row.cat === 'renewal') f.subs = round2(f.subs + row.gross);
        else f.other = round2(f.other + row.gross);
        f.count += 1;
        f.first = f.first === null ? row.t : Math.min(f.first, row.t);
        f.last = f.last === null ? row.t : Math.max(f.last, row.t);
        spend.set(row.fan, f);
      }
    }
    const subs = new Map<string, FanSubMonth>();
    for (const snap of subSnaps) {
      if (!snap.exists) continue;
      for (const [key, s] of Object.entries((snap.get('subs') ?? {}) as Record<string, { action: string; type: string }>)) {
        const [fan, atRaw] = key.split('_');
        const at = Number(atRaw);
        const e = subs.get(fan) ?? { n: 0, lastAt: null, lastType: null, isTrial: false };
        e.n += 1;
        if (e.lastAt === null || at > e.lastAt) Object.assign(e, { lastAt: at, lastType: s.action, isTrial: s.type.includes('trial') });
        subs.set(fan, e);
      }
    }

    const prevHashes = (digestSnap.get('hashes') ?? {}) as Record<string, string>;
    const hashes: Record<string, string> = {};
    const changed: string[] = [];
    for (const fan of new Set([...spend.keys(), ...subs.keys()])) {
      hashes[fan] = JSON.stringify([spend.get(fan) ?? null, subs.get(fan) ?? null]);
      if (prevHashes[fan] !== hashes[fan]) changed.push(fan);
    }
    const dropped = Object.keys(prevHashes).filter(f => !(f in hashes));
    if (changed.length === 0 && dropped.length === 0) continue;

    const fans = [...changed, ...dropped];
    const docRefs = fans.map(f => adminDb.collection('creator-fans').doc(`${creatorId}_${f}`));
    const docs = await getAllDocs(docRefs);
    const writer = adminDb.bulkWriter();
    docs.forEach((snap, i) => {
      const fan = fans[i];
      const subsByMonth = { ...((snap.get('subsByMonth') ?? {}) as Record<string, FanSubMonth>) };
      const thisSub = subs.get(fan);
      if (thisSub) subsByMonth[month] = thisSub;
      else delete subsByMonth[month];
      const all = Object.values(subsByMonth);
      const latest = all.filter(s => s.lastAt !== null).sort((a, b) => (b.lastAt ?? 0) - (a.lastAt ?? 0))[0];
      const f = spend.get(fan);
      const months = new Set<string>((snap.get('spendMonths') as string[] | undefined) ?? []);
      if (f) months.add(month);
      else months.delete(month);
      writer.set(
        docRefs[i],
        {
          creatorId,
          fanId: fan,
          name: snap.get('name') ?? null,
          nameSource: snap.get('nameSource') ?? null,
          spendByMonth: { [month]: f ? { tips: f.tips, ppv: f.ppv, subs: f.subs, other: f.other, count: f.count, first: f.first, last: f.last } : FieldValue.delete() },
          spendMonths: [...months].sort(),
          subsByMonth: { [month]: thisSub ?? FieldValue.delete() },
          subscriptions: latest
            ? {
                lastSubType: latest.lastType === 'return' ? 'returning_subscriber' : 'new_subscriber',
                isTrial: latest.isTrial,
                lastSubscribedAt: Timestamp.fromMillis(latest.lastAt!),
                subCount: all.reduce((s, x) => s + x.n, 0),
              }
            : null,
          acquisition: snap.get('acquisition') ?? null,
          linkTotalSpent: snap.get('linkTotalSpent') ?? null,
          isStacker: snap.get('isStacker') ?? false,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    });
    writer.set(digestRef, { creatorId, month, hashes, updatedAt: FieldValue.serverTimestamp() });
    await writer.close();
    bump(ctx, 'rollups.creatorFans', changed.length + dropped.length);
  }
}

// ─── balances (Phase 7, read-only) ───────────────────────────────────

/**
 * Payout balances and the latest payout requests per mapped account →
 * `account-balances/{creatorId}`. Skipped silently while
 * `ONLYMONSTER_STATEMENTS_KEY` is unset. Never creates anything.
 */
export async function syncBalancesStage(ctx: LedgerContext): Promise<void> {
  if (!isStatementsConfigured()) return;
  const writer = adminDb.bulkWriter();
  await forEachAccount(ctx, async acc => {
    const base = `/proxy/v0/platforms/onlyfans/accounts/${acc.platformAccountId}/statements`;
    const balance = await statementsGet<{ payoutAvailable: number; payoutPending: number; currency: string; withdrawalPeriod: string }>(`${base}/balances`);
    const payouts = await statementsGet<{ list: Array<{ invoiceId: string; createdAt: string; amount: number; currency: string; state: string; rejectReason: string | null }> }>(
      `${base}/payout-requests`,
      { limit: 10 },
    );
    writer.set(adminDb.collection('account-balances').doc(acc.creatorId), {
      creatorId: acc.creatorId,
      platformAccountId: acc.platformAccountId,
      available: balance.payoutAvailable,
      pending: balance.payoutPending,
      currency: balance.currency,
      withdrawalPeriod: balance.withdrawalPeriod,
      payouts: (payouts.list ?? []).map(p => ({ invoiceId: p.invoiceId, createdAt: p.createdAt, amount: p.amount, currency: p.currency, state: p.state, rejectReason: p.rejectReason })),
      checkedAt: FieldValue.serverTimestamp(),
    });
    bump(ctx, 'balances.accounts');
  });
  await writer.close();
}

export async function getBalances() {
  const snap = await adminDb.collection('account-balances').get();
  return snap.docs.map(d => ({
    creatorId: d.id,
    available: Number(d.get('available')) || 0,
    pending: Number(d.get('pending')) || 0,
    currency: String(d.get('currency') ?? 'USD'),
    payouts: (d.get('payouts') ?? []) as Array<{ invoiceId: string; createdAt: string; amount: number; state: string }>,
    checkedAt: (d.get('checkedAt') as Timestamp | undefined)?.toDate?.()?.toISOString() ?? null,
  }));
}
