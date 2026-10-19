/**
 * Chat-agent salary — the Firestore layer.
 *
 * The one rule that shapes this file: **nothing stores a computed salary.**
 * `buildSalaryMonth` reads sales, shifts, the time ledger, overrides and the
 * rate config, and hands them to the pure engine. A re-import, a corrected
 * shift or a rate change therefore flows through on the next read, and an
 * admin's override survives all three.
 *
 * The single exception is `ca-salary-months`, which exists precisely to freeze a
 * month at payout. A finalised month is served from that snapshot and never
 * recomputed — otherwise "what we paid" would silently change.
 *
 * Read budget (CLAUDE.md rule 9): one month for one agent costs 4 queries —
 * sales by `userId+month`, shifts by range, the time ledger, overrides by
 * `userId+month` — plus two cached document reads for the config and the
 * finalisation record. The roster view batches across agents rather than
 * looping this function per user.
 */

import { adminDb } from '../firebase-admin';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getShiftsByRange, getLedgerEntriesForUsers, getActiveSessionsForUsers } from './shiftService';
import { expandShiftsForWindow } from '../utils/recurrence';
import { serialiseShift } from '../utils/shiftSerialise';
import { computeTimeWorked } from '../utils/shiftAttendance';
import { computeSalaryMonth, DEFAULT_SALARY_CONFIG, round2, sumMonth } from '../salary/salaryEngine';
import { saleMatchKey } from '../buddyx/salesPlan';
import { lockIsStale } from '../disputes/disputeRules';
import { addMonths, currentMonthKey, monthKeyRange, toDayKey, type SalaryDayKey, type SalaryMonthKey } from '../salary/salaryDate';
import { isSalaryMonthVisible, PAID_LEAVE_ACCOUNT_LOOKBACK_DAYS } from '../salary/salaryConstants';
import { leaveAt, paidAccountsByDay, paidLeaveShifts, type LeaveWindow } from '../salary/leavePay';
import { matchSalesToSchedule, withoutDeparted, type Departures, type ScheduleMatch, type ScheduleSale } from '../salary/scheduleMatch';
import { normaliseSaleType, saleKindOf, saleSourceOf } from '../salary/saleTypes';
import type {
  DashboardSalaryMonth,
  RecentlyFinalizedSalary,
  SalaryConfig,
  SalaryDayInput,
  SalaryDayOverride,
  SalaryMonthResult,
  SalaryOverrideField,
  SalarySale,
  SalaryShiftInput,
} from '../salary/salaryTypes';
import type {
  CaSaleDocument,
  CaSalaryConfigDocument,
  CaSalaryMonthDocument,
  CaSalaryOverrideDocument,
  LeaveRequestDocument,
  ShiftDocument,
  TimeEntryLedgerDocument,
  ActiveSessionDocument,
} from '@/types/firestore';

const SALES = 'ca-sales';
const OVERRIDES = 'ca-salary-overrides';
const MONTHS = 'ca-salary-months';
const CONFIG = 'ca-salary-config';

/** Deterministic ids keep an override and a month record addressable without a query. */
const overrideId = (userId: string, day: SalaryDayKey) => `${userId}_${day}`;
const monthId = (userId: string, month: SalaryMonthKey) => `${userId}_${month}`;

// ─── Rate configuration ──────────────────────────────────────────────

/**
 * The rate table, cached in module scope for 60s.
 *
 * Same TTL and the same reasoning as `getUserById`: the config is read on every
 * salary request by every agent, changes a few times a year, and a stale minute
 * costs nothing. Invalidate explicitly on write — a serverless instance that
 * served the write must not keep serving the old table.
 */
let configCache: { value: SalaryConfig; at: number } | null = null;
const CONFIG_TTL_MS = 60_000;

export function invalidateSalaryConfigCache(): void {
  configCache = null;
}

export async function getSalaryConfig(): Promise<SalaryConfig> {
  if (configCache && Date.now() - configCache.at < CONFIG_TTL_MS) return configCache.value;

  const snap = await adminDb.collection(CONFIG).doc('current').get();
  let value: SalaryConfig = DEFAULT_SALARY_CONFIG;

  if (snap.exists) {
    const doc = snap.data() as CaSalaryConfigDocument;
    // Firestore map keys are strings; the engine keys the wage table by number.
    const wageTiers: Record<number, number> = {};
    for (const [key, rate] of Object.entries(doc.wageTiers ?? {})) {
      const count = Number(key);
      if (Number.isFinite(count) && Number.isFinite(rate)) wageTiers[count] = rate;
    }

    value = {
      deductionRate: doc.deductionRate ?? DEFAULT_SALARY_CONFIG.deductionRate,
      commissionTiers:
        Array.isArray(doc.commissionTiers) && doc.commissionTiers.length > 0
          ? [...doc.commissionTiers].sort((a, b) => a.minGross - b.minGross)
          : DEFAULT_SALARY_CONFIG.commissionTiers,
      wageTiers: Object.keys(wageTiers).length > 0 ? wageTiers : DEFAULT_SALARY_CONFIG.wageTiers,
      graceMinutes: doc.graceMinutes ?? DEFAULT_SALARY_CONFIG.graceMinutes,
      defaultShiftHours: doc.defaultShiftHours ?? DEFAULT_SALARY_CONFIG.defaultShiftHours,
      wageRateBasis: doc.wageRateBasis ?? DEFAULT_SALARY_CONFIG.wageRateBasis,
      updatedBy: doc.updatedBy ?? null,
      updatedAt: doc.updatedAt?.toDate?.()?.toISOString() ?? null,
    };
  }

  configCache = { value, at: Date.now() };
  return value;
}

export async function setSalaryConfig(
  config: Omit<SalaryConfig, 'updatedBy' | 'updatedAt'>,
  actorUid: string,
  actorName: string,
): Promise<void> {
  const wageTiers: Record<string, number> = {};
  for (const [count, rate] of Object.entries(config.wageTiers)) wageTiers[String(count)] = rate;

  await adminDb.collection(CONFIG).doc('current').set(
    {
      deductionRate: config.deductionRate,
      commissionTiers: [...config.commissionTiers].sort((a, b) => a.minGross - b.minGross),
      wageTiers,
      graceMinutes: config.graceMinutes,
      defaultShiftHours: config.defaultShiftHours,
      wageRateBasis: config.wageRateBasis,
      updatedBy: actorUid,
      updatedByName: actorName,
      updatedAt: FieldValue.serverTimestamp(),
    } satisfies Omit<CaSalaryConfigDocument, 'updatedAt'> & { updatedAt: unknown },
    { merge: true },
  );

  invalidateSalaryConfigCache();
}

// ─── Sales ───────────────────────────────────────────────────────────

export function serialiseSale(doc: CaSaleDocument): SalarySale {
  const transfer = doc.transfer ?? null;
  const sourceUserId = doc.sourceUserId !== undefined ? doc.sourceUserId : (doc.userId ?? null);
  return {
    saleId: doc.saleId,
    userId: doc.userId ?? null,
    day: doc.day,
    month: doc.month,
    occurredAt: doc.occurredAt?.toDate?.()?.toISOString() ?? new Date(0).toISOString(),
    employeeName: doc.employeeName ?? '',
    sourceEmail: doc.sourceEmail ?? '',
    creatorName: doc.creatorName ?? '',
    fanName: doc.fanName ?? '',
    fanId: doc.fanId ?? '',
    grossRevenue: doc.grossRevenue,
    netRevenue: doc.netRevenue,
    signedGross: doc.signedGross,
    type: normaliseSaleType(doc.type ?? ''),
    rule: doc.rule ?? '',
    assignedBy: doc.assignedBy ?? '',
    status: doc.status,
    importId: doc.importId ?? '',
    // Rows imported before the BuddyX integration carry none of these; the
    // defaults are what those rows always meant.
    source: saleSourceOf(doc, doc.occurredAt?.toMillis?.() ?? 0),
    kind: saleKindOf(doc),
    creatorId: doc.creatorId ?? null,
    modelId: doc.modelId ?? null,
    sourceUserId,
    buddyxUserId: doc.buddyxUserId !== undefined ? doc.buddyxUserId : sourceUserId,
    attributedBy: doc.attributedBy ?? 'buddyx',
    transfer: transfer
      ? {
          kind: transferKindOf(transfer),
          fromUserId: transfer.fromUserId ?? null,
          toUserId: transfer.toUserId ?? null,
          disputeId: transfer.disputeId ?? null,
          reason: transfer.reason ?? null,
          approvedBy: transfer.approvedBy,
          approvedAt: transfer.approvedAt?.toDate?.()?.toISOString() ?? new Date(0).toISOString(),
        }
      : null,
    disputeId: doc.disputeId ?? null,
    removedAt: doc.removedAt?.toDate?.()?.toISOString() ?? null,
    unmappedChatterId: doc.unmappedChatterId ?? null,
    attributionConflict: doc.attributionConflict === true,
    vanishedAfterFinalise: doc.vanishedAfterFinalise === true,
    assignment: transfer ? transferKindOf(transfer) : 'source',
    matchesSource: (doc.userId ?? null) === sourceUserId,
  };
}

/** Transfers written before admin reassignment existed carry no `kind`; all of them were disputes. */
function transferKindOf(transfer: NonNullable<CaSaleDocument['transfer']>): 'dispute' | 'admin' {
  return transfer.kind ?? (transfer.disputeId ? 'dispute' : 'admin');
}

/**
 * Whether a stored row counts toward pay.
 *
 * A row BuddyX no longer returns is soft-removed (`removedAt`) rather than
 * deleted, so it stays on record for audit — and it is excluded **here, in
 * memory**, on every read the engine is fed from. No index change, and the
 * engine never has to know removal exists.
 */
function counts(doc: CaSaleDocument): boolean {
  return !doc.removedAt;
}

/** Every sale for one agent in one month, oldest first. Removed rows excluded. */
export async function getSalesForMonth(userId: string, month: SalaryMonthKey): Promise<SalarySale[]> {
  const snap = await adminDb
    .collection(SALES)
    .where('userId', '==', userId)
    .where('month', '==', month)
    .orderBy('occurredAt', 'asc')
    .get();

  return snap.docs
    .map(d => d.data() as CaSaleDocument)
    .filter(counts)
    .map(serialiseSale);
}

/**
 * Every sale in one month for every agent, grouped by uid.
 *
 * One query for the whole roster instead of one per agent — the admin month
 * grid reads 8+ agents at once and an N+1 here would be the single most
 * expensive thing in the subsystem.
 *
 * Rows held by nobody (an unassigned tip, an unmapped chatter) and removed rows
 * are left out: neither counts toward anyone's pay. `getAllSalesInRange` is
 * the admin ledger's read, which keeps both.
 */
export async function getSalesForMonthByUser(month: SalaryMonthKey): Promise<Map<string, SalarySale[]>> {
  const snap = await adminDb.collection(SALES).where('month', '==', month).get();

  const byUser = new Map<string, SalarySale[]>();
  for (const doc of snap.docs) {
    const data = doc.data() as CaSaleDocument;
    if (!counts(data) || !data.userId) continue;
    const sale = serialiseSale(data);
    const list = byUser.get(data.userId);
    if (list) list.push(sale);
    else byUser.set(data.userId, [sale]);
  }
  for (const list of byUser.values()) list.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  return byUser;
}

/**
 * Every row whose sale instant falls in `[startMs, endMs)` — every agent,
 * unassigned and unmapped rows, removed rows — **newest first**. CA Admin →
 * Sales reads this for its date range. Served by the automatic single-field
 * `occurredAt` index (not exempt); the caller bounds the window.
 */
export async function getAllSalesInRange(startMs: number, endMs: number): Promise<SalarySale[]> {
  const snap = await adminDb
    .collection(SALES)
    .where('occurredAt', '>=', Timestamp.fromMillis(startMs))
    .where('occurredAt', '<', Timestamp.fromMillis(endMs))
    .orderBy('occurredAt', 'desc')
    .get();
  return snap.docs.map(d => serialiseSale(d.data() as CaSaleDocument));
}

/**
 * The shift schedule against each sale in a window — who was scheduled on the
 * sale's creator account at its instant, and whether its holder was one of
 * them (`matchSalesToSchedule`). One `getShiftsByRange` for every agent (the
 * same read the admin payroll grid makes), expanded in memory; the day of
 * lookback catches an overnight shift that began before the window. The BuddyX
 * sales sync calls it too, to credit each sale to the agent on shift. A shift a
 * departed agent still has on the roster stops counting from their departure.
 */
export async function getScheduleMatches(sales: ScheduleSale[], startMs: number, endMs: number, departures?: Departures) {
  if (sales.length === 0) return new Map<string, ScheduleMatch>();
  const shiftDocs = await getShiftsByRange(startMs - DAY_MS, endMs);
  const raw = shiftDocs.map(s => ({ ...serialiseShift(s), timeWorkedSeconds: null, attendanceStatus: null }));
  return matchSalesToSchedule(sales, withoutDeparted(expandShiftsForWindow(raw, startMs - DAY_MS, endMs), departures));
}

/**
 * Everyone archived or deactivated, with when they left: `offboardedAt`, else
 * (offboarded before the stamp existed) `updatedAt` — the offboarding write set
 * it, so it is never *earlier* than the real departure and never takes a sale
 * made before someone left. Two equality queries, field-masked; small sets.
 */
export async function getDepartures(): Promise<Departures> {
  const fields = ['uid', 'offboardedAt', 'updatedAt'] as const;
  const [archived, inactive] = await Promise.all([
    adminDb.collection('users').where('isArchived', '==', true).select(...fields).get(),
    adminDb.collection('users').where('isActive', '==', false).select(...fields).get(),
  ]);
  const out: Departures = new Map();
  for (const doc of [...archived.docs, ...inactive.docs]) {
    const uid = (doc.get('uid') as string | undefined) ?? doc.id;
    const at = (doc.get('offboardedAt') ?? doc.get('updatedAt')) as Timestamp | undefined;
    out.set(uid, at?.toMillis?.() ?? 0);
  }
  return out;
}

/**
 * Everything on a month's ledger that needs an admin's eye beyond what the
 * sync flags itself, plus the display names the ledger shows. One field-masked
 * `getAll` over every user the ledger names (holders, BuddyX attributions,
 * approvers, plus `extraUids` — names and archived state together) and one over the locking
 * disputes. Never a query.
 *
 * - **Stale dispute locks** — `lockIsStale`.
 * - **Possible duplicates** — live BuddyX rows sharing a `saleMatchKey` (the
 *   sync's own "same sale" fingerprint) under different ids. BuddyX ids are the
 *   identity, so both count; only a person can tell a double tip from a double row.
 * - **$0 rows** — a BuddyX data fault or a comped unlock; never silent.
 * - **Archived holders** — sales counting toward an agent who has left.
 */
export async function getLedgerAnomalies(rows: SalarySale[], extraUids: string[] = []) {
  const live = rows.filter(s => !s.removedAt);
  const uids = [
    ...new Set(
      [...rows.flatMap(s => [s.userId, s.sourceUserId, s.transfer?.approvedBy ?? null]), ...extraUids].filter((v): v is string => Boolean(v)),
    ),
  ];
  const lockIds = [...new Set(live.map(s => s.disputeId).filter((v): v is string => Boolean(v)))];
  const [userSnaps, lockSnaps] = await Promise.all([
    uids.length ? adminDb.getAll(...uids.map(id => adminDb.collection('users').doc(id)), { fieldMask: ['displayName', 'isArchived'] }) : [],
    lockIds.length ? adminDb.getAll(...lockIds.map(id => adminDb.collection('disputes').doc(id)), { fieldMask: ['AdminApproval', 'CaApproval'] }) : [],
  ]);

  const names = new Map<string, string>();
  const archived = new Set<string>();
  for (const snap of userSnaps) {
    if (!snap.exists) {
      archived.add(snap.id);
      continue;
    }
    names.set(snap.id, snap.get('displayName') ?? 'Unknown');
    if (snap.get('isArchived') === true) archived.add(snap.id);
  }
  const staleDisputes = new Set(lockSnaps.filter(lockIsStale).map(snap => snap.id));

  const byFacts = new Map<string, string[]>();
  const archivedHolders = new Map<string, { gross: number; count: number }>();
  for (const s of live) {
    if (s.source === 'buddyx') {
      const key = saleMatchKey({ kind: s.kind, modelId: s.modelId, fanId: s.fanId, occurredAtMs: Date.parse(s.occurredAt), gross: s.grossRevenue });
      const ids = byFacts.get(key);
      if (ids) ids.push(s.saleId);
      else byFacts.set(key, [s.saleId]);
    }
    if (s.userId && archived.has(s.userId)) {
      const sum = archivedHolders.get(s.userId) ?? { gross: 0, count: 0 };
      sum.gross = round2(sum.gross + s.signedGross);
      sum.count += 1;
      archivedHolders.set(s.userId, sum);
    }
  }

  return {
    names,
    flags: {
      staleLocks: live.filter(s => s.disputeId && staleDisputes.has(s.disputeId)).map(s => s.saleId),
      possibleDuplicates: [...byFacts.values()].filter(ids => ids.length > 1).flat(),
      zeroGross: live.filter(s => s.grossRevenue === 0).map(s => s.saleId),
      archivedHolders: [...archivedHolders].map(([uid, sum]) => ({ uid, ...sum })),
    },
  };
}

/**
 * Sales BuddyX credits to this agent that Bluu Backend holds on someone else
 * (or on nobody) — moved by an approved dispute or by an admin. What is in
 * their BuddyX but not in their report, and why. Served by the
 * `sourceUserId ASC, month ASC` index.
 *
 * A sale moved off this agent that BuddyX has *since* re-credited elsewhere is
 * deliberately not here: neither system credits it to them any more, so there
 * is nothing for them to reconcile.
 *
 * Until that index is deployed the query fails precondition, and this falls
 * back to the older `transferFromUserId` read (dispute moves only) rather than
 * taking the whole report down with it.
 */
export async function getTransferredAwaySales(userId: string, month: SalaryMonthKey): Promise<SalarySale[]> {
  let docs: CaSaleDocument[];
  try {
    const snap = await adminDb
      .collection(SALES)
      .where('sourceUserId', '==', userId)
      .where('month', '==', month)
      .get();
    docs = snap.docs.map(d => d.data() as CaSaleDocument);
  } catch (err) {
    if ((err as { code?: number }).code !== 9) throw err; // FAILED_PRECONDITION: index not built yet
    console.warn('[getTransferredAwaySales] sourceUserId index missing — falling back to transferFromUserId');
    const snap = await adminDb
      .collection(SALES)
      .where('transferFromUserId', '==', userId)
      .where('month', '==', month)
      .get();
    docs = snap.docs.map(d => d.data() as CaSaleDocument).filter(d => d.sourceUserId === userId);
  }
  return docs
    .filter(d => counts(d) && d.userId !== userId)
    .map(serialiseSale)
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
}

/** Remove a single Infloww history sale — the admin-only delete on the payroll Sales Report. Permanent. */
export async function deleteSale(saleId: string): Promise<void> {
  await adminDb.collection(SALES).doc(saleId).delete();
}


// ─── Overrides ───────────────────────────────────────────────────────

function serialiseOverride(doc: CaSalaryOverrideDocument): SalaryDayOverride {
  const fields: SalaryDayOverride['fields'] = {};
  for (const [key, entry] of Object.entries(doc.fields ?? {})) {
    if (!entry) continue;
    // Optional keys are omitted, never set to `undefined`: these entries are
    // copied verbatim into `day.overrides` and frozen by `finalizeMonth`, and
    // Firestore rejects an `undefined` value — the whole finalise then 500s.
    fields[key as SalaryOverrideField] = {
      value: entry.value,
      setBy: entry.setBy,
      ...(entry.setByName ? { setByName: entry.setByName } : {}),
      setAt: entry.setAt?.toDate?.()?.toISOString() ?? new Date(0).toISOString(),
      ...(entry.reason ? { reason: entry.reason } : {}),
    };
  }
  return { day: doc.day, userId: doc.userId, fields, note: doc.note ?? null };
}

export async function getOverridesForMonth(userId: string, month: SalaryMonthKey): Promise<SalaryDayOverride[]> {
  const snap = await adminDb
    .collection(OVERRIDES)
    .where('userId', '==', userId)
    .where('month', '==', month)
    .get();
  return snap.docs.map(d => serialiseOverride(d.data() as CaSalaryOverrideDocument));
}

/** Every override in a month across all agents, keyed by uid — the roster's batched read. */
export async function getOverridesForMonthByUser(month: SalaryMonthKey): Promise<Map<string, SalaryDayOverride[]>> {
  const snap = await adminDb.collection(OVERRIDES).where('month', '==', month).get();
  const byUser = new Map<string, SalaryDayOverride[]>();
  for (const doc of snap.docs) {
    const o = serialiseOverride(doc.data() as CaSalaryOverrideDocument);
    const list = byUser.get(o.userId);
    if (list) list.push(o);
    else byUser.set(o.userId, [o]);
  }
  return byUser;
}

/**
 * Set one field's override on one day.
 *
 * Dotted field paths so two admins editing different fields of the same day do
 * not clobber each other — `set({fields: {...}}, {merge:true})` would replace
 * the whole `fields` map if the caller built it from a stale read.
 */
export async function setOverrideField(params: {
  userId: string;
  day: SalaryDayKey;
  field: SalaryOverrideField;
  value: number;
  actorUid: string;
  actorName: string;
  reason?: string;
}): Promise<void> {
  const { userId, day, field, value, actorUid, actorName, reason } = params;
  const ref = adminDb.collection(OVERRIDES).doc(overrideId(userId, day));

  await ref.set(
    {
      userId,
      day,
      month: day.slice(0, 7),
      updatedAt: FieldValue.serverTimestamp(),
      fields: {
        [field]: {
          value,
          setBy: actorUid,
          setByName: actorName,
          setAt: Timestamp.now(),
          ...(reason ? { reason } : {}),
        },
      },
    },
    { mergeFields: ['userId', 'day', 'month', 'updatedAt', `fields.${field}`] },
  );
}

/** Revert one field to its computed value. Deletes the day's document once empty. */
export async function clearOverrideField(userId: string, day: SalaryDayKey, field: SalaryOverrideField): Promise<void> {
  const ref = adminDb.collection(OVERRIDES).doc(overrideId(userId, day));
  await ref.update({ [`fields.${field}`]: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() });

  const snap = await ref.get();
  const data = snap.data() as CaSalaryOverrideDocument | undefined;
  if (data && Object.keys(data.fields ?? {}).length === 0 && !data.note) await ref.delete();
}

/** Revert every field on a day. */
export async function clearDayOverrides(userId: string, day: SalaryDayKey): Promise<void> {
  await adminDb.collection(OVERRIDES).doc(overrideId(userId, day)).delete();
}

export async function setDayNote(userId: string, day: SalaryDayKey, note: string | null): Promise<void> {
  const ref = adminDb.collection(OVERRIDES).doc(overrideId(userId, day));
  await ref.set(
    { userId, day, month: day.slice(0, 7), note: note || null, updatedAt: FieldValue.serverTimestamp() },
    { mergeFields: ['userId', 'day', 'month', 'note', 'updatedAt'] },
  );
}

// ─── Finalisation ────────────────────────────────────────────────────

export async function getFinalizedMonth(userId: string, month: SalaryMonthKey): Promise<CaSalaryMonthDocument | null> {
  const snap = await adminDb.collection(MONTHS).doc(monthId(userId, month)).get();
  if (!snap.exists) return null;
  const doc = snap.data() as CaSalaryMonthDocument;
  return doc.status === 'finalized' ? doc : null;
}

/** Which of these agents have this month finalised — one batched read for the roster. */
export async function getFinalizedMonthsFor(userIds: string[], month: SalaryMonthKey): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();
  const refs = userIds.map(uid => adminDb.collection(MONTHS).doc(monthId(uid, month)));
  const snaps = await adminDb.getAll(...refs);

  const out = new Set<string>();
  for (const snap of snaps) {
    if (!snap.exists) continue;
    const doc = snap.data() as CaSalaryMonthDocument;
    if (doc.status === 'finalized') out.add(doc.userId);
  }
  return out;
}

/**
 * Freeze a month at its current computed values.
 *
 * The snapshot is taken here rather than by the caller so the thing written is
 * provably what the engine produced — a caller passing its own numbers is how a
 * payout record ends up disagreeing with the grid it was read from.
 *
 * **Finalising does not touch leave** (since 2026-10-10). Leave balances are
 * derived per month and per year from requests (`leaveBalance.ts`), so there is
 * nothing to reset — a new month simply has no requests in it yet.
 */
export async function finalizeMonth(params: {
  userId: string;
  month: SalaryMonthKey;
  actorUid: string;
  actorName: string;
  reason?: string;
}): Promise<{ totals: SalaryMonthResult['totals'] }> {
  const { userId, month, actorUid, actorName, reason } = params;

  const computed = await buildSalaryMonth(userId, month, { ignoreFinalized: true });

  const doc = {
    userId,
    month,
    status: 'finalized' as const,
    finalizedAt: FieldValue.serverTimestamp(),
    finalizedBy: actorUid,
    finalizedByName: actorName,
    days: computed.days,
    totals: computed.totals,
    history: FieldValue.arrayUnion({
      action: 'finalized',
      by: actorUid,
      byName: actorName,
      at: Timestamp.now(),
      ...(reason ? { reason } : {}),
    }),
    updatedAt: FieldValue.serverTimestamp(),
  };

  const monthRef = adminDb.collection(MONTHS).doc(monthId(userId, month));
  await monthRef.set(doc, { merge: true });

  // What was just frozen is `computed` — no need to read it back.
  return { totals: computed.totals };
}

/**
 * Reopen a finalised month.
 *
 * The frozen `days` are deliberately left in place: they are the record of what
 * was paid, and the history entry is what says the month went live again. The
 * next read recomputes because `status` no longer reads `finalized`.
 */
export async function reopenMonth(params: {
  userId: string;
  month: SalaryMonthKey;
  actorUid: string;
  actorName: string;
  reason?: string;
}): Promise<void> {
  const { userId, month, actorUid, actorName, reason } = params;
  await adminDb
    .collection(MONTHS)
    .doc(monthId(userId, month))
    .set(
      {
        status: 'reopened',
        history: FieldValue.arrayUnion({
          action: 'reopened',
          by: actorUid,
          byName: actorName,
          at: Timestamp.now(),
          ...(reason ? { reason } : {}),
        }),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
}

// ─── The assembler ───────────────────────────────────────────────────

/** Per-shift worked seconds for one agent over a window, keyed `shiftId:occurrenceStart`. */
function resolveShiftInputs(
  shiftDocs: ShiftDocument[],
  userId: string,
  windowStart: number,
  windowEnd: number,
  sessions: TimeEntryLedgerDocument[],
  activeSession: ActiveSessionDocument | undefined,
  now: number,
): Map<SalaryDayKey, SalaryShiftInput[]> {
  const raw = shiftDocs
    .filter(s => s.userId === userId)
    .map(s => ({ ...serialiseShift(s), timeWorkedSeconds: null, attendanceStatus: null }));

  const byDay = new Map<SalaryDayKey, SalaryShiftInput[]>();

  for (const occurrence of expandShiftsForWindow(raw, windowStart, windowEnd)) {
    const start = occurrence.occurrenceStart;
    const end = occurrence.occurrenceEnd;

    // A shift still in progress is credited only up to now; crediting to its
    // scheduled end would pay an agent for hours they have not worked yet and
    // make today's figure fall as the day goes on.
    const effectiveEnd = Math.min(end, now);
    const trackedSeconds = effectiveEnd > start ? computeTimeWorked(start, effectiveEnd, sessions, activeSession) : 0;

    // A shift is attributed to the salary day it *starts* on, so an overnight
    // shift pays whole on one day rather than splitting across a boundary the
    // roster does not recognise.
    const day = toDayKey(start);
    const input: SalaryShiftInput = {
      shiftId: occurrence.shiftId,
      occurrenceStart: start,
      scheduledHours: Math.max(0, (end - start) / 3_600_000),
      trackedSeconds,
      creatorIds: occurrence.creatorIds ?? [],
      overtimeCreatorIds: occurrence.overtimeCreatorIds ?? [],
      isOvertime: occurrence.isOvertime ?? false,
      paysWage: occurrence.paysWage ?? true,
    };

    const list = byDay.get(day);
    if (list) list.push(input);
    else byDay.set(day, [input]);
  }

  return byDay;
}

/** Fold sales into per-day totals. */
function foldSales(sales: SalarySale[]): Map<SalaryDayKey, { gross: number; count: number; creators: string[] }> {
  const byDay = new Map<SalaryDayKey, { gross: number; count: number; creators: string[] }>();
  for (const sale of sales) {
    const entry = byDay.get(sale.day) ?? { gross: 0, count: 0, creators: [] };
    entry.gross += sale.signedGross;
    entry.count += 1;
    if (sale.creatorName) entry.creators.push(sale.creatorName);
    byDay.set(sale.day, entry);
  }
  return byDay;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Shift docs are read from this far before the month: far enough for a paid
 * leave day on the 1st to find "the previous day's accounts" (`leavePay.ts`),
 * and so also past the 8h the time ledger looks back.
 */
const SHIFT_LOOKBACK_MS = PAID_LEAVE_ACCOUNT_LOOKBACK_DAYS * DAY_MS;

/** A leave request's live start: where approval actually released it (§6), else the pinned one. */
function leaveStart(leave: LeaveRequestDocument): number {
  return leave.releasedOccurrenceStart ?? leave.occurrenceStart;
}

/**
 * Approved leave whose shift starts in the month, or up to a day before it — a
 * late shift on the last day of the previous month still owns its sales past
 * midnight. Pass a `userId` for one agent (two equalities, single-field
 * indexes); omit it for everyone (one range on `occurrenceStart`, the query the
 * allowance route already runs). Neither needs a composite index (rule 9).
 */
async function getApprovedLeave(userId: string | null, month: SalaryMonthKey): Promise<LeaveRequestDocument[]> {
  const [windowStart, windowEnd] = monthKeyRange(month);
  const from = windowStart - DAY_MS;

  const snap = userId
    ? await adminDb.collection('leave_requests').where('userId', '==', userId).where('status', '==', 'approved').get()
    : await adminDb
        .collection('leave_requests')
        .where('occurrenceStart', '>=', from - DAY_MS)
        .where('occurrenceStart', '<', windowEnd + DAY_MS)
        .get();

  return snap.docs
    .map(doc => doc.data() as LeaveRequestDocument)
    .filter(leave => leave.status === 'approved')
    .filter(leave => {
      const start = leaveStart(leave);
      return start >= from && start < windowEnd;
    });
}

/**
 * Each leave request as the window its shift occupied.
 *
 * The request pins only a start, and approval removed the shift from the
 * roster — but not from Firestore: a recurring date is tombstoned by an
 * override document carrying the occurrence's `startTime`/`endTime`, and a
 * one-off is soft-deleted in place. Both are in `shiftDocs` already, so the end
 * is looked up rather than queried. A shift that cannot be found (deleted
 * outright) falls back to the configured shift length.
 */
function resolveLeaveWindows(
  leaves: readonly LeaveRequestDocument[],
  shiftDocs: readonly ShiftDocument[],
  config: SalaryConfig,
): Map<string, LeaveWindow[]> {
  const endByStart = new Map<string, number>();
  for (const doc of shiftDocs) {
    const start = doc.startTime?.toMillis?.();
    const end = doc.endTime?.toMillis?.();
    if (typeof start === 'number' && typeof end === 'number' && end > start) {
      endByStart.set(`${doc.userId}:${start}`, end);
    }
  }

  const byUser = new Map<string, LeaveWindow[]>();
  for (const leave of leaves) {
    const start = leaveStart(leave);
    const end =
      endByStart.get(`${leave.userId}:${start}`) ??
      endByStart.get(`${leave.userId}:${leave.occurrenceStart}`) ??
      start + config.defaultShiftHours * 3_600_000;
    const list = byUser.get(leave.userId) ?? [];
    list.push({ leaveId: leave.leaveId, leaveType: leave.leaveType, start, end });
    byUser.set(leave.userId, list);
  }
  return byUser;
}

/** Leave by salary day, for the grid's chip. Days are "the day the shift starts". */
function leaveTypesByDay(leaves: readonly LeaveRequestDocument[]): Map<SalaryDayKey, Array<'paid' | 'unpaid'>> {
  const byDay = new Map<SalaryDayKey, Array<'paid' | 'unpaid'>>();
  for (const leave of leaves) {
    const day = toDayKey(leaveStart(leave));
    const types = byDay.get(day) ?? [];
    if (!types.includes(leave.leaveType)) types.push(leave.leaveType);
    byDay.set(day, types);
  }
  return byDay;
}

/**
 * Attach the chip. Applied to a finalised snapshot too, replacing whatever it
 * stored: leave can be withdrawn after payday and the chip should say what is
 * true now — though the snapshot's pay, correctly, does not move.
 */
function withLeave(
  result: SalaryMonthResult,
  leaveByDay: Map<SalaryDayKey, Array<'paid' | 'unpaid'>>,
): SalaryMonthResult {
  return {
    ...result,
    days: result.days.map(day => {
      const leave = leaveByDay.get(day.day);
      const rest = { ...day };
      delete rest.leave;
      return leave ? { ...rest, leave } : rest;
    }),
  };
}

/**
 * One agent's engine input for the month — the step both builders share, so
 * the single-agent grid and the roster cannot price leave differently.
 *
 * Sales inside a leave window are dropped before folding, and paid leave is
 * added as a shift (`leavePay.ts`).
 */
function assembleDays(params: {
  userId: string;
  month: SalaryMonthKey;
  shiftDocs: ShiftDocument[];
  sales: SalarySale[];
  leaveWindows: LeaveWindow[];
  sessions: TimeEntryLedgerDocument[];
  activeSession: ActiveSessionDocument | undefined;
  now: number;
}): SalaryDayInput[] {
  const { userId, month, shiftDocs, sales, leaveWindows, sessions, activeSession, now } = params;
  const [windowStart, windowEnd] = monthKeyRange(month);

  const shiftsByDay = resolveShiftInputs(shiftDocs, userId, windowStart, windowEnd, sessions, activeSession, now);

  if (leaveWindows.some(w => w.leaveType === 'paid')) {
    const raw = shiftDocs
      .filter(s => s.userId === userId)
      .map(s => ({ ...serialiseShift(s), timeWorkedSeconds: null, attendanceStatus: null }));
    const accounts = paidAccountsByDay(expandShiftsForWindow(raw, windowStart - SHIFT_LOOKBACK_MS, windowEnd));
    for (const [day, inputs] of paidLeaveShifts(leaveWindows, accounts)) {
      shiftsByDay.set(day, [...(shiftsByDay.get(day) ?? []), ...inputs]);
    }
  }

  const counted = leaveWindows.length > 0 ? sales.filter(s => !leaveAt(Date.parse(s.occurredAt), leaveWindows)) : sales;
  const salesByDay = foldSales(counted);

  const days: SalaryDayInput[] = [];
  for (const day of new Set([...salesByDay.keys(), ...shiftsByDay.keys()])) {
    // A shift or a sale can fall just outside the month once timezones are
    // applied; the engine only reads days inside the month, but filtering here
    // keeps the input honest.
    if (day.slice(0, 7) !== month) continue;
    const sale = salesByDay.get(day);
    days.push({
      day,
      grossEarnings: sale?.gross ?? 0,
      saleCount: sale?.count ?? 0,
      salesCreatorNames: sale?.creators ?? [],
      shifts: shiftsByDay.get(day) ?? [],
    });
  }
  return days;
}

/**
 * The approved-leave windows covering one agent's month, for the sales report:
 * it has to mark the same rows the grid dropped. Costs the shift range read
 * the window ends come from.
 */
export async function getLeaveWindowsForMonth(userId: string, month: SalaryMonthKey): Promise<LeaveWindow[]> {
  const leaves = await getApprovedLeave(userId, month);
  if (leaves.length === 0) return [];
  const [windowStart, windowEnd] = monthKeyRange(month);
  const [shiftDocs, config] = await Promise.all([
    getShiftsByRange(windowStart - DAY_MS, windowEnd, userId),
    getSalaryConfig(),
  ]);
  return resolveLeaveWindows(leaves, shiftDocs, config).get(userId) ?? [];
}

export interface BuildSalaryMonthOptions {
  /** Recompute even when the month is finalised — only `finalizeMonth` should pass this. */
  ignoreFinalized?: boolean;
  /** Pre-fetched rate config, to avoid re-reading it per agent in the roster view. */
  config?: SalaryConfig;
  now?: number;
}

/**
 * Everything one agent earned in one month.
 *
 * Serves the frozen snapshot when the month is finalised, and otherwise
 * recomputes from source. Both paths return the same shape, with `status`
 * saying which one the caller got — the agent's dashboard renders "paid" from
 * it and the admin grid decides whether cells are editable.
 */
export async function buildSalaryMonth(
  userId: string,
  month: SalaryMonthKey,
  options: BuildSalaryMonthOptions = {},
): Promise<SalaryMonthResult> {
  const now = options.now ?? Date.now();
  const config = options.config ?? (await getSalaryConfig());
  // Started now so it runs alongside everything below. Leave moves pay, so an
  // open month fails without it; a frozen one only loses the chip.
  const leavePromise = getApprovedLeave(userId, month);
  leavePromise.catch(() => {}); // awaited on every path; this only stops an early throw orphaning it

  if (!options.ignoreFinalized) {
    const frozen = await getFinalizedMonth(userId, month);
    if (frozen) {
      const leaves = await leavePromise.catch(err => {
        console.error('[caSalaryService] leave overlay failed', err);
        return [] as LeaveRequestDocument[];
      });
      return withLeave({
        userId,
        month,
        days: frozen.days as SalaryMonthResult['days'],
        totals: frozen.totals,
        tier: computeSalaryMonth({ userId, month, days: [], overrides: [], config }).tier,
        config,
        status: 'finalized',
        finalizedAt: frozen.finalizedAt?.toDate?.()?.toISOString() ?? null,
        finalizedBy: frozen.finalizedBy ?? null,
        finalizedByName: frozen.finalizedByName ?? null,
      }, leaveTypesByDay(leaves));
    }
  }

  const [windowStart, windowEnd] = monthKeyRange(month);

  // A session that began before the window can still carry time into it, so the
  // ledger is fetched from 8h earlier — longer than any shift plus its overrun.
  const LEDGER_LOOKBACK_MS = 8 * 60 * 60 * 1000;

  const [sales, overrides, shiftDocs, ledgerByUser, activeSessions, leaves] = await Promise.all([
    getSalesForMonth(userId, month),
    getOverridesForMonth(userId, month),
    getShiftsByRange(windowStart - SHIFT_LOOKBACK_MS, windowEnd, userId),
    getLedgerEntriesForUsers([userId], windowStart - LEDGER_LOOKBACK_MS, windowEnd),
    getActiveSessionsForUsers([userId]),
    leavePromise,
  ]);

  const days = assembleDays({
    userId,
    month,
    shiftDocs,
    sales,
    leaveWindows: resolveLeaveWindows(leaves, shiftDocs, config).get(userId) ?? [],
    sessions: ledgerByUser.get(userId) ?? [],
    activeSession: activeSessions.get(userId),
    now,
  });

  const result = computeSalaryMonth({ userId, month, days, overrides, config });
  return withLeave(result, leaveTypesByDay(leaves.filter(l => toDayKey(leaveStart(l)).slice(0, 7) === month)));
}

/**
 * The month the agent's dashboard summary should show: the earliest one still
 * owed to them.
 *
 * On the 1st the calendar has moved on but payroll has not — last month is not
 * paid until an admin finalises it, and a card that jumped to the new month's
 * $0 would hide the figure the agent is actually waiting on. So the previous
 * month wins while it is **open and has anything in it**; once it is finalised
 * (or was empty — a new starter has no last month to wait for) the current
 * month takes over.
 *
 * Only one month back. An older month still open is a payroll backlog for an
 * admin to clear, not something the dashboard should silently rewind to.
 *
 * Cost: before finalisation, one month build (the previous month's). After, one
 * snapshot read plus the current month's build — the same as before this
 * existed, plus a single document read.
 */
export async function buildDashboardSalaryMonth(
  userId: string,
  options: Pick<BuildSalaryMonthOptions, 'now'> = {},
): Promise<DashboardSalaryMonth> {
  const now = options.now ?? Date.now();
  const config = await getSalaryConfig();
  const current = currentMonthKey(now);

  const previousKey = addMonths(current, -1);
  if (!isSalaryMonthVisible(previousKey)) {
    return { ...(await buildSalaryMonth(userId, current, { now, config })), recentlyFinalized: null };
  }
  const previous = await buildSalaryMonth(userId, previousKey, { now, config });
  if (previous.status === 'open' && previous.days.length > 0) {
    return { ...previous, recentlyFinalized: null };
  }

  const result = await buildSalaryMonth(userId, current, { now, config });
  return { ...result, recentlyFinalized: recentlyFinalizedSummary(previous, now) };
}

/**
 * How long the dashboard keeps a "last month was finalised" card up. Long
 * enough to be seen by an agent who only opens the app on shift days; short
 * enough that it is news, not furniture.
 */
export const RECENTLY_FINALIZED_WINDOW_MS = 5 * 24 * 60 * 60 * 1000;

/**
 * The previous month's payout, while it is fresh. Comes off the build
 * `buildDashboardSalaryMonth` already did — a finalised month is one snapshot
 * read — so the card costs nothing extra.
 */
function recentlyFinalizedSummary(previous: SalaryMonthResult, now: number): RecentlyFinalizedSalary | null {
  if (previous.status !== 'finalized' || !previous.finalizedAt) return null;
  const finalizedMs = Date.parse(previous.finalizedAt);
  if (!Number.isFinite(finalizedMs) || now - finalizedMs > RECENTLY_FINALIZED_WINDOW_MS) return null;
  return {
    month: previous.month,
    salary: previous.totals.salary,
    commission: previous.totals.commission,
    wage: previous.totals.wage,
    finalizedAt: previous.finalizedAt,
  };
}

/**
 * The month CA Admin's payroll view should open on — the roster-wide twin of
 * `buildDashboardSalaryMonth`.
 *
 * The previous month while **any** active chat agent still has it open with
 * something in it; otherwise the current month. Same "has something in it" test
 * as the agent's card (`days.length > 0`), so an agent who started this month
 * does not pin payroll to a month they never worked.
 *
 * Cost (rule 9): the CA roster query plus one batched read of last month's
 * snapshots. Only while unfinalised agents remain does it build their previous
 * month to check for activity — and that build is skipped entirely once payroll
 * has finalised everyone.
 */
export async function resolvePayrollMonth(now: number = Date.now()): Promise<SalaryMonthKey> {
  const current = currentMonthKey(now);
  const previous = addMonths(current, -1);
  if (!isSalaryMonthVisible(previous)) return current;

  // Same roster as `/roster` and `/overview`, filtered rather than queried on
  // `isArchived` for the same reason (rule 6).
  const snap = await adminDb
    .collection('users')
    .where('groups', 'array-contains', 'CA')
    .select('uid', 'isArchived')
    .get();
  const uids = snap.docs
    .map(d => d.data())
    .filter(u => u.isArchived !== true)
    .map(u => (u.uid as string | undefined) ?? '')
    .filter(Boolean);

  const finalized = await getFinalizedMonthsFor(uids, previous);
  const pending = uids.filter(uid => !finalized.has(uid));
  if (pending.length === 0) return current;

  const months = await buildSalaryMonthForUsers(pending, previous, { now });
  for (const result of months.values()) {
    if (result.status === 'open' && result.days.length > 0) return previous;
  }
  return current;
}

/**
 * Build the month for several agents at once.
 *
 * Three collection queries total (sales, overrides, shifts) rather than three
 * per agent, then the pure engine per agent. This is what the admin roster and
 * the payroll summary read.
 *
 * `options.salesByUser` lets a caller that has *already* read the month's sales
 * hand them in rather than paying for the same query twice. The Overview tab
 * needs the raw rows to build its agent × creator matrix and the totals to
 * build its header, and those are the same sales — reading them once is rule 9
 * applied to the most expensive query in the subsystem.
 */
export async function buildSalaryMonthForUsers(
  userIds: string[],
  month: SalaryMonthKey,
  options: { now?: number; salesByUser?: Map<string, SalarySale[]> } = {},
): Promise<Map<string, SalaryMonthResult>> {
  const [result] = await buildSalaryMonthForUsersUnder(userIds, month, [await getSalaryConfig()], options);
  return result;
}

/**
 * The same build, priced under several rate configs from **one** set of reads.
 *
 * What the Rates dry run uses: the live config and the draft are compared over
 * identical sales, shifts and overrides, so the difference is the rates and
 * nothing else — and the comparison costs the reads of one build, not two.
 * Finalised months come back from their snapshot under every config, because a
 * rate change never restates them.
 */
export async function buildSalaryMonthForUsersUnder(
  userIds: string[],
  month: SalaryMonthKey,
  configs: SalaryConfig[],
  options: { now?: number; salesByUser?: Map<string, SalarySale[]> } = {},
): Promise<Array<Map<string, SalaryMonthResult>>> {
  const outs = configs.map(() => new Map<string, SalaryMonthResult>());
  if (userIds.length === 0) return outs;

  const now = options.now ?? Date.now();
  const [windowStart, windowEnd] = monthKeyRange(month);
  const LEDGER_LOOKBACK_MS = 8 * 60 * 60 * 1000;

  const [salesByUser, overridesByUser, shiftDocs, ledgerByUser, activeSessions, finalized, leaves] = await Promise.all([
    options.salesByUser ?? getSalesForMonthByUser(month),
    getOverridesForMonthByUser(month),
    getShiftsByRange(windowStart - SHIFT_LOOKBACK_MS, windowEnd),
    getLedgerEntriesForUsers(userIds, windowStart - LEDGER_LOOKBACK_MS, windowEnd),
    getActiveSessionsForUsers(userIds),
    getFinalizedMonthsFor(userIds, month),
    getApprovedLeave(null, month),
  ]);
  // Priced once for everyone; every config below shares the same windows, since
  // a draft rate table changes what leave pays, never which days it covers.
  const leaveWindowsByUser = resolveLeaveWindows(leaves, shiftDocs, configs[0] ?? DEFAULT_SALARY_CONFIG);

  // Finalised months are served from their snapshot, which needs a document
  // read each — but only for the few agents actually finalised.
  const frozenDocs = new Map<string, CaSalaryMonthDocument>();
  if (finalized.size > 0) {
    const refs = [...finalized].map(uid => adminDb.collection(MONTHS).doc(monthId(uid, month)));
    for (const snap of await adminDb.getAll(...refs)) {
      if (snap.exists) {
        const doc = snap.data() as CaSalaryMonthDocument;
        frozenDocs.set(doc.userId, doc);
      }
    }
  }

  for (const userId of userIds) {
    const frozen = frozenDocs.get(userId);
    if (frozen) {
      configs.forEach((config, i) =>
        outs[i].set(userId, {
          userId,
          month,
          days: frozen.days as SalaryMonthResult['days'],
          totals: frozen.totals,
          tier: computeSalaryMonth({ userId, month, days: [], overrides: [], config }).tier,
          config,
          status: 'finalized',
          finalizedAt: frozen.finalizedAt?.toDate?.()?.toISOString() ?? null,
          finalizedBy: frozen.finalizedBy ?? null,
          finalizedByName: frozen.finalizedByName ?? null,
        }),
      );
      continue;
    }

    const days = assembleDays({
      userId,
      month,
      shiftDocs,
      sales: salesByUser.get(userId) ?? [],
      leaveWindows: leaveWindowsByUser.get(userId) ?? [],
      sessions: ledgerByUser.get(userId) ?? [],
      activeSession: activeSessions.get(userId),
      now,
    });

    configs.forEach((config, i) =>
      outs[i].set(
        userId,
        computeSalaryMonth({ userId, month, days, overrides: overridesByUser.get(userId) ?? [], config }),
      ),
    );
  }

  return outs;
}

/** Re-export so callers need only this module. */
export { sumMonth };
