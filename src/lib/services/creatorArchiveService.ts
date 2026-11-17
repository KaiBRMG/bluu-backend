/**
 * What archiving a creator account does beyond the `creators` doc.
 *
 * 1. **The schedule lets go of it from the archive instant on** —
 *    `removeArchivedAccountsFromSchedule`. Shifts not yet started lose the
 *    account; shifts already started keep it, because they are what pay is
 *    priced on (see `archiveShiftPlan.ts`). Open overtime-board offers for it
 *    are cancelled, so nobody claims cover for an account that is gone.
 * 2. **Sales stop being imported from the archive instant on** —
 *    `archiveCutoffsFor`, read by the OnlyMonster pay derivation. Sales before
 *    it stay exactly as they are: visible, payable and disputable.
 * 3. **It stays pickable for disputes until its archive month is closed** —
 *    `openArchivedAccountIds`, read by the dispute dialog and CA Admin → Sales.
 *
 * The archive instant is `archivedAt`, stamped when `isArchived` turns true and
 * cleared on restore. An account archived before the stamp existed has none,
 * and is treated as it always was: never in a picker, still imported.
 *
 * Restoring an account does **not** put it back on any shift — the cleanup is
 * a one-way edit to the roster, and an admin re-assigns by hand.
 */
import 'server-only';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '../firebase-admin';
import { commitSeriesSplit, getLeaveForSplit } from './shiftService';
import { cancelOffer } from './caCoverageService';
import { getFinalizedMonthsFor } from './caSalaryService';
import { planArchiveShifts, type PlanLeave, type PlanShift } from '../creators/archiveShiftPlan';
import { addMonths, currentMonthKey, toDayKey, toMonthKey } from '../salary/salaryDate';
import type { CaCoverageOfferDocument, ShiftDocument } from '@/types/firestore';

const SHIFTS = 'shifts';
const OFFERS = 'ca-coverage-offers';
const CREATORS = 'creators';
const SUBACCOUNTS = 'creator-subaccounts';
const DAY_MS = 24 * 3_600_000;

const ms = (t: unknown): number | null => {
  if (t && typeof (t as Timestamp).toMillis === 'function') return (t as Timestamp).toMillis();
  return null;
};

// ─── Which ids an archive takes off the roster ───────────────────────

/**
 * A creator's archive takes its sub-accounts with it: every picker already
 * treats them as archived (`creatorAccountService`), so leaving them on shifts
 * would be the same stale assignment one level down. A sub-account's own
 * archive takes only itself.
 */
export async function accountIdsForCreatorArchive(creatorId: string): Promise<string[]> {
  const subs = await adminDb.collection(SUBACCOUNTS).where('parentCreatorId', '==', creatorId).select().get();
  return [creatorId, ...subs.docs.map(d => d.id)];
}

// ─── 1. The schedule ─────────────────────────────────────────────────

export interface ArchiveScheduleReport {
  offersCancelled: number;
  shiftsUpdated: number;
  shiftsDeleted: number;
  seriesSplit: number;
  /** Rostered shifts that now cover no account — still on the roster, for an admin to re-assign. */
  shiftsLeftEmpty: number;
}

function toPlanShift(doc: ShiftDocument): PlanShift {
  return {
    shiftId: doc.shiftId,
    userId: doc.userId,
    startMs: ms(doc.startTime) ?? 0,
    endMs: ms(doc.endTime) ?? 0,
    wallClockStart: doc.wallClockStart,
    wallClockEnd: doc.wallClockEnd,
    userTimezone: doc.userTimezone,
    isRecurring: doc.isRecurring === true,
    recurrence: doc.recurrence ?? null,
    seriesId: doc.seriesId ?? null,
    overrideDateMs: ms(doc.overrideDate),
    isDeleted: doc.isDeleted === true,
    creatorIds: doc.creatorIds ?? [],
    overtimeCreatorIds: doc.overtimeCreatorIds ?? [],
    isOvertime: doc.isOvertime === true,
    coverageOfferId: doc.coverageOfferId ?? null,
    paysWage: doc.paysWage !== false,
    createdBy: doc.createdBy,
  };
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Take `accountIds` off every shift that starts at or after `cutoffMs`, and
 * off the overtime board. Safe to re-run.
 */
export async function removeArchivedAccountsFromSchedule(params: {
  accountIds: string[];
  cutoffMs: number;
  actorUid: string;
}): Promise<ArchiveScheduleReport> {
  const { accountIds, cutoffMs, actorUid } = params;
  const ids = new Set(accountIds);
  const report: ArchiveScheduleReport = { offersCancelled: 0, shiftsUpdated: 0, shiftsDeleted: 0, seriesSplit: 0, shiftsLeftEmpty: 0 };
  if (accountIds.length === 0) return report;

  // ── The overtime board first ──
  // `cancelOffer` also takes the account off whatever shift the offer was
  // assigned to, so the shift read below sees the result. Read by `day` (the
  // board's own index) from the day before, filtered in memory — `creatorId`
  // and `windowStart` are index-exempt, and the open board is small.
  const offerSnap = await adminDb.collection(OFFERS).where('day', '>=', toDayKey(cutoffMs - DAY_MS)).get();
  for (const d of offerSnap.docs) {
    const offer = d.data() as CaCoverageOfferDocument;
    if (!ids.has(offer.creatorId) || offer.status === 'cancelled' || offer.windowStart < cutoffMs) continue;
    await cancelOffer(d.id);
    report.offersCancelled += 1;
  }

  // ── Every shift holding one of the ids ──
  // No date filter on purpose: a recurring root's `startTime` is its *first*
  // occurrence, so a roster created in January would be invisible to a
  // `startTime >=` query (ca-salary.md §6). Served by the existing
  // `creatorIds` CONTAINS index; `array-contains-any` takes up to 30 values.
  const held = (
    await Promise.all(
      chunk(accountIds, 30).map(c => adminDb.collection(SHIFTS).where('creatorIds', 'array-contains-any', c).get()),
    )
  ).flatMap(s => s.docs.map(d => ({ ...(d.data() as ShiftDocument), shiftId: d.id })));

  const byId = new Map(held.map(s => [s.shiftId, toPlanShift(s)]));
  const roots = [...byId.values()].filter(s => s.isRecurring && !s.seriesId && !s.isDeleted);

  // Overrides and tombstones of those roots — the split re-points them.
  if (roots.length > 0) {
    const overrideSnaps = await Promise.all(
      chunk(roots.map(r => r.shiftId), 30).map(c => adminDb.collection(SHIFTS).where('seriesId', 'in', c).get()),
    );
    for (const snap of overrideSnaps) {
      for (const d of snap.docs) if (!byId.has(d.id)) byId.set(d.id, toPlanShift({ ...(d.data() as ShiftDocument), shiftId: d.id }));
    }
  }

  // Approved leave that may have released an occurrence of a split series.
  // `occurrenceStart` is indexed (the balance and roster reads use it);
  // `releasedShiftId` is not, so it is matched in the planner. A week's
  // slack covers an occurrence the release resolved away from its pin.
  const leaves: PlanLeave[] = roots.length > 0 ? await getLeaveForSplit(cutoffMs) : [];

  const plan = planArchiveShifts({ accountIds, cutoffMs, shifts: [...byId.values()], leaves });
  report.shiftsLeftEmpty = plan.emptied.length;

  // ── Splits: one batch each, because half a split is worse than none ──
  for (const split of plan.splits) {
    const r = split.newRoot;
    await commitSeriesSplit({
      rootId: split.rootId,
      truncateAtMs: split.truncateAtMs,
      newRoot: {
        userId: r.userId,
        startTime: r.startMs,
        endTime: r.endMs,
        wallClockStart: r.wallClockStart,
        wallClockEnd: r.wallClockEnd,
        userTimezone: r.userTimezone,
        createdBy: actorUid,
        recurrence: r.recurrence,
        creatorIds: r.creatorIds,
        overtimeCreatorIds: r.overtimeCreatorIds,
        isOvertime: r.isOvertime,
        coverageOfferId: r.coverageOfferId,
        paysWage: r.paysWage,
      },
      repoint: split.repoint.map(o => ({ shiftId: o.shiftId, patch: o.patch ? { ...o.patch } : null })),
      leaves: split.leaves,
    });
    report.seriesSplit += 1;
  }

  // ── Plain detaches ──
  const writer = adminDb.bulkWriter();
  for (const { shiftId, patch } of plan.patches) {
    writer.update(adminDb.collection(SHIFTS).doc(shiftId), { ...patch, updatedAt: FieldValue.serverTimestamp() });
  }
  for (const shiftId of plan.deletes) writer.delete(adminDb.collection(SHIFTS).doc(shiftId));
  await writer.close();
  report.shiftsUpdated = plan.patches.length;
  report.shiftsDeleted = plan.deletes.length;

  return report;
}

// ─── 2 & 3. Cut-offs ─────────────────────────────────────────────────

interface ArchiveFacts {
  isArchived: boolean;
  archivedAt: number | null;
  parentCreatorId: string | null;
}

/**
 * Each id's archive instant, or nothing when it is live (or was archived
 * before `archivedAt` existed). A sub-account of an archived creator takes the
 * creator's instant, unless it was archived first.
 */
export async function archiveCutoffsFor(accountIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const unique = [...new Set(accountIds)];
  if (unique.length === 0) return out;

  const mask = { fieldMask: ['isArchived', 'archivedAt', 'parentCreatorId'] };
  const [creatorSnaps, subSnaps] = await Promise.all([
    adminDb.getAll(...unique.map(id => adminDb.collection(CREATORS).doc(id)), mask),
    adminDb.getAll(...unique.map(id => adminDb.collection(SUBACCOUNTS).doc(id)), mask),
  ]);
  const facts = new Map<string, ArchiveFacts>();
  const read = (snap: FirebaseFirestore.DocumentSnapshot): ArchiveFacts => ({
    isArchived: snap.get('isArchived') === true,
    archivedAt: ms(snap.get('archivedAt')),
    parentCreatorId: (snap.get('parentCreatorId') as string | undefined) ?? null,
  });
  creatorSnaps.forEach(s => s.exists && facts.set(s.id, read(s)));
  subSnaps.forEach(s => s.exists && facts.set(s.id, read(s)));

  const missingParents = [...new Set([...facts.values()].map(f => f.parentCreatorId).filter((p): p is string => !!p && !facts.has(p)))];
  if (missingParents.length > 0) {
    const parents = await adminDb.getAll(...missingParents.map(id => adminDb.collection(CREATORS).doc(id)), mask);
    parents.forEach(s => s.exists && facts.set(s.id, read(s)));
  }

  for (const id of unique) {
    const f = facts.get(id);
    if (!f) continue;
    const own = f.isArchived ? f.archivedAt : null;
    const parent = f.parentCreatorId ? facts.get(f.parentCreatorId) : undefined;
    const inherited = parent?.isArchived ? parent.archivedAt : null;
    const cutoff = own !== null && inherited !== null ? Math.min(own, inherited) : own ?? inherited;
    if (cutoff !== null) out.set(id, cutoff);
  }
  return out;
}

let openCache: { at: number; ids: string[] } | null = null;

const HOLDERS_TTL_MS = 10 * 60_000;
const holdersCache = new Map<string, { at: number; holders: string[]; hasUnassigned: boolean }>();

/**
 * Who holds a sale on an archived account in its archive month — the one
 * expensive read here (every sale that month), so it is cached for 10 minutes
 * per instance. It barely moves once the account is archived: nothing new is
 * imported after `archivedAt`, so only a dispute transfer changes a holder, and
 * a holder ten minutes stale costs at most a picker entry that lingers.
 * Finalisation is re-checked on every miss of the short cache instead — that
 * is the fact that actually closes the month, and it is one `getAll`.
 */
async function archiveMonthHolders(accountId: string, month: string, now: number) {
  const key = `${accountId}|${month}`;
  const hit = holdersCache.get(key);
  if (hit && now - hit.at < HOLDERS_TTL_MS) return hit;
  const sales = await adminDb
    .collection('ca-sales')
    .where('creatorId', '==', accountId)
    .where('month', '==', month)
    .select('userId', 'removedAt')
    .get();
  const live = sales.docs.filter(s => !s.get('removedAt'));
  const entry = {
    at: now,
    holders: [...new Set(live.map(s => s.get('userId') as string | null).filter((u): u is string => !!u))],
    hasUnassigned: live.some(s => !s.get('userId')),
  };
  holdersCache.set(key, entry);
  return entry;
}

/**
 * Archived accounts that must still appear in the sale pickers (the dispute
 * dialog, CA Admin → Sales): those whose **archive month** is not yet closed.
 *
 * Finalisation is per agent-month, so "the month is closed" means: every agent
 * holding a sale on the account in that month has finalised it. A month with no
 * such sale has nothing to dispute; it stays open only while it is the current
 * month, which also covers the previous month's sales — those are searchable
 * exactly while that month is "last month", i.e. during the archive month.
 * An archive month older than last month is closed outright: the sale search
 * cannot reach it.
 *
 * An **unassigned** sale in the archive month keeps the account open while the
 * search can reach that month: it has no holder to finalise, and it is the
 * sale agents most often claim.
 *
 * Cost: one read of archived creators, one of every sub-account (their
 * `isArchived` is index-exempt), then per account archived this month or last,
 * the month's holders (cached 10 min — `archiveMonthHolders`) and one `getAll`
 * of month records. The whole answer is cached 60 s.
 */
export async function openArchivedAccountIds(now = Date.now()): Promise<string[]> {
  if (openCache && now - openCache.at < 60_000) return openCache.ids;

  const [creatorSnap, subSnap] = await Promise.all([
    adminDb.collection(CREATORS).where('isArchived', '==', true).select('archivedAt').get(),
    adminDb.collection(SUBACCOUNTS).select('isArchived', 'archivedAt', 'parentCreatorId').get(),
  ]);
  const cutoffs = new Map<string, number>();
  for (const d of creatorSnap.docs) {
    const at = ms(d.get('archivedAt'));
    if (at !== null) cutoffs.set(d.id, at);
  }
  for (const d of subSnap.docs) {
    const own = d.get('isArchived') === true ? ms(d.get('archivedAt')) : null;
    const parent = cutoffs.get(d.get('parentCreatorId') as string) ?? null;
    const at = own !== null && parent !== null ? Math.min(own, parent) : own ?? parent;
    if (at !== null) cutoffs.set(d.id, at);
  }

  const thisMonth = currentMonthKey(now);
  const lastMonth = addMonths(thisMonth, -1);
  const open: string[] = [];
  await Promise.all(
    [...cutoffs].map(async ([id, at]) => {
      const month = toMonthKey(at);
      if (month < lastMonth) return;
      const { holders, hasUnassigned } = await archiveMonthHolders(id, month, now);
      // An unassigned sale ("Nobody on shift") is claimable whatever anyone has
      // finalised — it is exactly what agents dispute — so it keeps the account
      // open for as long as the search can reach its month.
      if (hasUnassigned) {
        open.push(id);
        return;
      }
      if (holders.length === 0) {
        if (month === thisMonth) open.push(id);
        return;
      }
      const finalised = await getFinalizedMonthsFor(holders, month);
      if (holders.some(uid => !finalised.has(uid))) open.push(id);
    }),
  );

  openCache = { at: now, ids: open.sort() };
  return openCache.ids;
}

/** Drop the cached picker list — after an archive, a restore, or a finalisation. */
export function invalidateOpenArchivedCache(): void {
  openCache = null;
}
