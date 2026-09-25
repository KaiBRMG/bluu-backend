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
import { computeSalaryMonth, DEFAULT_SALARY_CONFIG, sumMonth } from '../salary/salaryEngine';
import { monthKeyRange, toDayKey, type SalaryDayKey, type SalaryMonthKey } from '../salary/salaryDate';
import { computeFinalizationReset } from '../leave/leaveBalance';
import { invalidateUserCache } from './userService';
import type {
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
  UserDocument,
  TimeEntryLedgerDocument,
  ActiveSessionDocument,
} from '@/types/firestore';

const SALES = 'ca-sales';
const IMPORTS = 'ca-sales-imports';
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

function serialiseSale(doc: CaSaleDocument): SalarySale {
  return {
    saleId: doc.saleId,
    userId: doc.userId,
    day: doc.day,
    month: doc.month,
    occurredAt: doc.occurredAt?.toDate?.()?.toISOString() ?? new Date(0).toISOString(),
    employeeName: doc.employeeName,
    sourceEmail: doc.sourceEmail,
    creatorName: doc.creatorName,
    fanName: doc.fanName,
    fanId: doc.fanId,
    grossRevenue: doc.grossRevenue,
    netRevenue: doc.netRevenue,
    signedGross: doc.signedGross,
    type: doc.type,
    rule: doc.rule,
    assignedBy: doc.assignedBy,
    status: doc.status,
    importId: doc.importId,
  };
}

/** Every sale for one agent in one month, oldest first. */
export async function getSalesForMonth(userId: string, month: SalaryMonthKey): Promise<SalarySale[]> {
  const snap = await adminDb
    .collection(SALES)
    .where('userId', '==', userId)
    .where('month', '==', month)
    .orderBy('occurredAt', 'asc')
    .get();

  return snap.docs.map(d => serialiseSale(d.data() as CaSaleDocument));
}

/**
 * Every sale in one month for every agent, grouped by uid.
 *
 * One query for the whole roster instead of one per agent — the admin month
 * grid reads 8+ agents at once and an N+1 here would be the single most
 * expensive thing in the subsystem.
 */
export async function getSalesForMonthByUser(month: SalaryMonthKey): Promise<Map<string, SalarySale[]>> {
  const snap = await adminDb.collection(SALES).where('month', '==', month).get();

  const byUser = new Map<string, SalarySale[]>();
  for (const doc of snap.docs) {
    const sale = serialiseSale(doc.data() as CaSaleDocument);
    const list = byUser.get(sale.userId);
    if (list) list.push(sale);
    else byUser.set(sale.userId, [sale]);
  }
  for (const list of byUser.values()) list.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  return byUser;
}

/**
 * Write imported sales.
 *
 * `bulkWriter` rather than chunked batches (rule 9), and `set` rather than
 * `create` so a re-upload of an overlapping export rewrites the same documents
 * instead of failing. The count of pre-existing ids is read first so the import
 * report can distinguish "imported" from "already had it" — that number is how
 * an admin knows a re-upload did nothing rather than silently doubling a month.
 */
export async function writeSales(sales: SalarySale[]): Promise<{ written: number; duplicates: number }> {
  if (sales.length === 0) return { written: 0, duplicates: 0 };

  const refs = sales.map(s => adminDb.collection(SALES).doc(s.saleId));
  const existing = new Set<string>();
  for (let i = 0; i < refs.length; i += 300) {
    const snaps = await adminDb.getAll(...refs.slice(i, i + 300));
    for (const snap of snaps) if (snap.exists) existing.add(snap.id);
  }

  const writer = adminDb.bulkWriter();
  for (const sale of sales) {
    writer.set(adminDb.collection(SALES).doc(sale.saleId), {
      ...sale,
      occurredAt: Timestamp.fromMillis(Date.parse(sale.occurredAt)),
      createdAt: FieldValue.serverTimestamp(),
    });
  }
  await writer.close();

  return { written: sales.length - existing.size, duplicates: existing.size };
}

/** Remove a single sale. Used when a source export retracts a row an earlier one carried. */
export async function deleteSale(saleId: string): Promise<void> {
  await adminDb.collection(SALES).doc(saleId).delete();
}

/** Delete every sale from one import — the undo for a file uploaded by mistake. */
export async function deleteSalesByImport(importId: string): Promise<number> {
  const snap = await adminDb.collection(SALES).where('importId', '==', importId).get();
  if (snap.empty) return 0;

  const writer = adminDb.bulkWriter();
  for (const doc of snap.docs) writer.delete(doc.ref);
  await writer.close();
  return snap.size;
}

export async function recordImport(doc: Record<string, unknown> & { importId: string }): Promise<void> {
  await adminDb.collection(IMPORTS).doc(doc.importId).set({ ...doc, uploadedAt: FieldValue.serverTimestamp() });
}

export async function getRecentImports(limit = 20) {
  const snap = await adminDb.collection(IMPORTS).orderBy('uploadedAt', 'desc').limit(limit).get();
  return snap.docs.map(d => {
    const data = d.data();
    return { ...data, uploadedAt: data.uploadedAt?.toDate?.()?.toISOString() ?? null };
  });
}

// ─── Overrides ───────────────────────────────────────────────────────

function serialiseOverride(doc: CaSalaryOverrideDocument): SalaryDayOverride {
  const fields: SalaryDayOverride['fields'] = {};
  for (const [key, entry] of Object.entries(doc.fields ?? {})) {
    if (!entry) continue;
    fields[key as SalaryOverrideField] = {
      value: entry.value,
      setBy: entry.setBy,
      setByName: entry.setByName,
      setAt: entry.setAt?.toDate?.()?.toISOString() ?? new Date(0).toISOString(),
      reason: entry.reason,
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
 * Freeze a month at its current computed values, and reset the agent's leave.
 *
 * The snapshot is taken here rather than by the caller so the thing written is
 * provably what the engine produced — a caller passing its own numbers is how a
 * payout record ends up disagreeing with the grid it was read from.
 *
 * **Finalising is what resets leave.** Unpaid leave goes to 4 for the next
 * month, and on a December paid leave also goes to 10 for the next year. The
 * reset is assigned, not added (`computeFinalizationReset`). It is written in
 * the **same transaction** as the frozen month, so a month cannot end up paid
 * with its reset lost, or reset without being paid. A re-finalise after a
 * reopen is a no-op for leave, because the stamp only moves forward.
 */
export async function finalizeMonth(params: {
  userId: string;
  month: SalaryMonthKey;
  actorUid: string;
  actorName: string;
  reason?: string;
}): Promise<{ month: CaSalaryMonthDocument; leaveReset: Record<string, string | number> | null }> {
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
  const userRef = adminDb.collection('users').doc(userId);

  const leaveReset = await adminDb.runTransaction(async tx => {
    const userSnap = await tx.get(userRef);
    const updates = userSnap.exists
      ? computeFinalizationReset(userSnap.data() as UserDocument, month)
      : null;
    tx.set(monthRef, doc, { merge: true });
    if (updates) tx.update(userRef, updates);
    return updates;
  });

  // Rule 2: the balance on the user document just moved.
  if (leaveReset) invalidateUserCache(userId);

  const snap = await monthRef.get();
  return { month: snap.data() as CaSalaryMonthDocument, leaveReset };
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

/**
 * Approved leave in a month, by salary day.
 *
 * A **read-time annotation**, not an engine input: the engine does not price
 * leave, and an approved absence has already removed its shift from the roster
 * (the occurrence is tombstoned), so without this the day simply reads as a day
 * not worked. Attributed by `toDayKey(occurrenceStart)` — the same "the day the
 * shift starts on" rule the shifts themselves are paid by.
 *
 * Applied to a finalised snapshot too, and replacing whatever it stored: leave
 * can still be withdrawn after a month is paid, and the marker should say what
 * is true now. One query on two equality filters, which single-field indexes
 * serve (rule 9).
 */
async function getApprovedLeaveByDay(
  userId: string,
  month: SalaryMonthKey,
): Promise<Map<SalaryDayKey, Array<'paid' | 'unpaid'>>> {
  const snap = await adminDb
    .collection('leave_requests')
    .where('userId', '==', userId)
    .where('status', '==', 'approved')
    .get();

  const byDay = new Map<SalaryDayKey, Array<'paid' | 'unpaid'>>();
  for (const doc of snap.docs) {
    const leave = doc.data() as LeaveRequestDocument;
    const day = toDayKey(leave.occurrenceStart);
    if (day.slice(0, 7) !== month) continue;
    const types = byDay.get(day) ?? [];
    if (!types.includes(leave.leaveType)) types.push(leave.leaveType);
    byDay.set(day, types);
  }
  return byDay;
}

function withLeave(
  result: SalaryMonthResult,
  leaveByDay: Map<SalaryDayKey, Array<'paid' | 'unpaid'>>,
): SalaryMonthResult {
  return {
    ...result,
    days: result.days.map(day => {
      // Replace rather than keep a stored value: see `getApprovedLeaveByDay`.
      const leave = leaveByDay.get(day.day);
      const rest = { ...day };
      delete rest.leave;
      return leave ? { ...rest, leave } : rest;
    }),
  };
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
  // Started now, awaited at each return, so it runs alongside everything below.
  // Non-fatal: a marker that could not be read must not take down a payslip,
  // and the catch also keeps an early throw below from orphaning a rejection.
  const leavePromise = getApprovedLeaveByDay(userId, month).catch(err => {
    console.error('[caSalaryService] leave overlay failed', err);
    return new Map<SalaryDayKey, Array<'paid' | 'unpaid'>>();
  });

  if (!options.ignoreFinalized) {
    const frozen = await getFinalizedMonth(userId, month);
    if (frozen) {
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
      }, await leavePromise);
    }
  }

  const [windowStart, windowEnd] = monthKeyRange(month);

  // A session that began before the window can still carry time into it, so the
  // ledger is fetched from 8h earlier — longer than any shift plus its overrun.
  const LEDGER_LOOKBACK_MS = 8 * 60 * 60 * 1000;

  const [sales, overrides, shiftDocs, ledgerByUser, activeSessions] = await Promise.all([
    getSalesForMonth(userId, month),
    getOverridesForMonth(userId, month),
    getShiftsByRange(windowStart - LEDGER_LOOKBACK_MS, windowEnd, userId),
    getLedgerEntriesForUsers([userId], windowStart - LEDGER_LOOKBACK_MS, windowEnd),
    getActiveSessionsForUsers([userId]),
  ]);

  const shiftsByDay = resolveShiftInputs(
    shiftDocs,
    userId,
    windowStart,
    windowEnd,
    ledgerByUser.get(userId) ?? [],
    activeSessions.get(userId),
    now,
  );
  const salesByDay = foldSales(sales);

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

  const result = computeSalaryMonth({ userId, month, days, overrides, config });

  // A month that was finalised and then reopened keeps its record; surface the
  // reopen so the UI can say "previously paid" rather than implying it never was.
  return withLeave(result, await leavePromise);
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
  const out = new Map<string, SalaryMonthResult>();
  if (userIds.length === 0) return out;

  const now = options.now ?? Date.now();
  const config = await getSalaryConfig();
  const [windowStart, windowEnd] = monthKeyRange(month);
  const LEDGER_LOOKBACK_MS = 8 * 60 * 60 * 1000;

  const [salesByUser, overridesByUser, shiftDocs, ledgerByUser, activeSessions, finalized] = await Promise.all([
    options.salesByUser ?? getSalesForMonthByUser(month),
    getOverridesForMonthByUser(month),
    getShiftsByRange(windowStart - LEDGER_LOOKBACK_MS, windowEnd),
    getLedgerEntriesForUsers(userIds, windowStart - LEDGER_LOOKBACK_MS, windowEnd),
    getActiveSessionsForUsers(userIds),
    getFinalizedMonthsFor(userIds, month),
  ]);

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
      out.set(userId, {
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
      });
      continue;
    }

    const shiftsByDay = resolveShiftInputs(
      shiftDocs,
      userId,
      windowStart,
      windowEnd,
      ledgerByUser.get(userId) ?? [],
      activeSessions.get(userId),
      now,
    );
    const salesByDay = foldSales(salesByUser.get(userId) ?? []);

    const days: SalaryDayInput[] = [];
    for (const day of new Set([...salesByDay.keys(), ...shiftsByDay.keys()])) {
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

    out.set(
      userId,
      computeSalaryMonth({ userId, month, days, overrides: overridesByUser.get(userId) ?? [], config }),
    );
  }

  return out;
}

/** Re-export so callers need only this module. */
export { sumMonth };
