/**
 * Taking an archived account off the schedule — the decision, pure.
 *
 * When a creator (or a sub-account) is archived, every shift that holds it and
 * has **not started yet** loses it. Everything that started before the archive
 * keeps it, untouched: those shifts are what the salary engine prices, and
 * removing an account from worked time would re-tier the agent's wage for work
 * already done (ca-salary.md §2). An occurrence under way at the archive instant
 * counts as started.
 *
 * Three shapes of shift, three treatments:
 *
 * - **A one-off, an override or a soft-deleted occurrence** starting at or after
 *   the cutoff: the account comes off `creatorIds` and `overtimeCreatorIds`
 *   together (the two are one fact — ca-salary.md §6). A shift *coverage built*
 *   that is left with no accounts is deleted, exactly as `detachAccountFromShift`
 *   decides; a rostered shift left empty is kept and reported, because deleting
 *   it would delete somebody's working day.
 * - **A recurring root whose first occurrence is after the cutoff**: nothing in
 *   it has been worked, so it is patched in place.
 * - **A recurring root already under way**: its `creatorIds` are the assignment
 *   for *every* occurrence, past ones included, so it cannot be patched. It is
 *   **split**, the way "edit this and future" splits one: the old root is
 *   truncated before the first occurrence at/after the cutoff and a new root
 *   carries the series on without the account. Two things the PUT path does not
 *   do, and this must:
 *   - `count` is reduced by the occurrences the old root already emitted, or a
 *     "10 occurrences" roster would run to 10 more.
 *   - Override and tombstone documents dated on/after the split are **re-pointed**
 *     to the new root. Left on the old one, an edited occurrence would show
 *     beside the new root's copy of that date, and an approved-leave tombstone
 *     would stop suppressing it — the agent back on the roster on a day their
 *     accounts are on the overtime board. Approved leave that released one of
 *     those dates has its `releasedShiftId` moved too, or withdrawing it would
 *     look for the tombstone under the old root and never put the shift back.
 *
 * Idempotent: a re-run finds the truncated root still holding the account but
 * emitting nothing after the cutoff, and the new root without it.
 */

import { findSeriesSplit } from '../utils/recurrence';
import type { ShiftRecurrence } from '@/types/firestore';

/** A shift document with its timestamps as ms — what the planner needs and nothing else. */
export interface PlanShift {
  shiftId: string;
  userId: string;
  startMs: number;
  endMs: number;
  wallClockStart: string;
  wallClockEnd: string;
  userTimezone: string;
  isRecurring: boolean;
  recurrence: ShiftRecurrence | null;
  seriesId: string | null;
  overrideDateMs: number | null;
  isDeleted: boolean;
  creatorIds: string[];
  overtimeCreatorIds: string[];
  isOvertime: boolean;
  coverageOfferId: string | null;
  paysWage: boolean;
  createdBy: string;
}

export interface PlanLeave {
  leaveId: string;
  status: 'pending' | 'approved' | 'denied';
  shiftId: string;
  occurrenceStart: number;
  releasedShiftId: string | null;
  releasedOccurrenceStart: number | null;
}

export interface AssignmentPatch {
  creatorIds: string[];
  overtimeCreatorIds: string[];
}

export interface SeriesSplitPlan {
  rootId: string;
  /** Pass to `truncateSeriesAt` — UTC midnight of the first date the new root owns. */
  truncateAtMs: number;
  /** The new root, minus the id the service mints. */
  newRoot: Omit<PlanShift, 'shiftId'>;
  /** Override / tombstone docs that move to the new root, with any detach folded in. */
  repoint: Array<{ shiftId: string; patch: AssignmentPatch | null }>;
  /** Approved leave whose released occurrence now belongs to the new root. */
  leaves: Array<{ leaveId: string; releasedOccurrenceStart: number }>;
}

export interface ArchiveShiftPlan {
  patches: Array<{ shiftId: string; patch: AssignmentPatch }>;
  deletes: string[];
  splits: SeriesSplitPlan[];
  /** Rostered shifts (by id, or `new:<rootId>` for a split's new root) left with no account. */
  emptied: string[];
}

type Detach = { kind: 'none' } | { kind: 'delete' } | { kind: 'patch'; patch: AssignmentPatch };

/**
 * `detachAccountFromShift` for several ids at once (an archived creator takes
 * its sub-accounts with it). Same rule: delete only what coverage created.
 */
export function detachAccounts(shift: Pick<PlanShift, 'creatorIds' | 'overtimeCreatorIds' | 'coverageOfferId'>, ids: ReadonlySet<string>): Detach {
  if (!shift.creatorIds.some(id => ids.has(id))) return { kind: 'none' };
  const creatorIds = shift.creatorIds.filter(id => !ids.has(id));
  const overtimeCreatorIds = shift.overtimeCreatorIds.filter(id => !ids.has(id));
  if (shift.coverageOfferId && creatorIds.length === 0) return { kind: 'delete' };
  return { kind: 'patch', patch: { creatorIds, overtimeCreatorIds } };
}

const isRoot = (s: PlanShift) => s.isRecurring && !s.seriesId && !s.isDeleted && s.recurrence !== null;

/**
 * @param accountIds the archived account and, for a creator, its sub-accounts
 * @param cutoffMs   the archive instant
 * @param shifts     every shift holding one of `accountIds`, plus every override
 *                   and tombstone of the recurring roots among them
 * @param leaves     leave requests with an occurrence at/after the cutoff
 */
export function planArchiveShifts(params: {
  accountIds: readonly string[];
  cutoffMs: number;
  shifts: PlanShift[];
  leaves: PlanLeave[];
}): ArchiveShiftPlan {
  const { cutoffMs, shifts, leaves } = params;
  const ids = new Set(params.accountIds);
  const plan: ArchiveShiftPlan = { patches: [], deletes: [], splits: [], emptied: [] };

  const overridesOf = new Map<string, PlanShift[]>();
  for (const s of shifts) {
    if (!s.seriesId) continue;
    const list = overridesOf.get(s.seriesId) ?? [];
    list.push(s);
    overridesOf.set(s.seriesId, list);
  }

  /** Docs a split re-points; their detach travels with the re-point instead of as a patch. */
  const handledBySplit = new Set<string>();

  for (const root of shifts.filter(isRoot)) {
    if (!root.creatorIds.some(id => ids.has(id))) continue;
    const split = findSeriesSplit({ ...root, startTimeMs: root.startMs, recurrence: root.recurrence! }, cutoffMs);
    if (!split) continue; // the series emits nothing after the cutoff — all history

    const detached = detachAccounts(root, ids);
    if (detached.kind !== 'patch') continue; // a root is never coverage-built; defensive

    if (split.before === 0) {
      // Not one occurrence worked yet: the whole series is schedule.
      plan.patches.push({ shiftId: root.shiftId, patch: detached.patch });
      if (detached.patch.creatorIds.length === 0) plan.emptied.push(root.shiftId);
      continue;
    }

    const rule = root.recurrence!;
    const remaining = rule.count != null ? rule.count - split.before : null;
    if (remaining !== null && remaining <= 0) continue;

    const repoint: SeriesSplitPlan['repoint'] = [];
    for (const o of overridesOf.get(root.shiftId) ?? []) {
      if (o.overrideDateMs === null || o.overrideDateMs < split.overrideDateMs) continue;
      handledBySplit.add(o.shiftId);
      // Soft-deleted docs are detached too: an edited occurrence later released
      // for leave is an override with `isDeleted: true` that still holds its
      // accounts, and withdrawing that leave restores it as it stands.
      const d = o.startMs >= cutoffMs ? detachAccounts(o, ids) : ({ kind: 'none' } as Detach);
      // An override is never coverage-built, so `delete` cannot arise; treat it as a patch to empty.
      const patch = d.kind === 'patch' ? d.patch : d.kind === 'delete' ? { creatorIds: [], overtimeCreatorIds: [] } : null;
      repoint.push({ shiftId: o.shiftId, patch });
      if (patch && patch.creatorIds.length === 0 && !o.isDeleted) plan.emptied.push(o.shiftId);
    }

    const movedLeaves = leaves
      .filter(l => l.status === 'approved')
      .map(l => ({
        leaveId: l.leaveId,
        shiftId: l.releasedShiftId ?? l.shiftId,
        start: l.releasedOccurrenceStart ?? l.occurrenceStart,
      }))
      .filter(l => l.shiftId === root.shiftId && l.start >= split.occurrenceStart)
      .map(l => ({ leaveId: l.leaveId, releasedOccurrenceStart: l.start }));

    const { shiftId: _rootId, ...rest } = root;
    void _rootId;
    plan.splits.push({
      rootId: root.shiftId,
      truncateAtMs: split.overrideDateMs,
      newRoot: {
        ...rest,
        startMs: split.occurrenceStart,
        endMs: split.occurrenceEnd,
        recurrence: { ...rule, count: remaining, parentShiftId: null },
        creatorIds: detached.patch.creatorIds,
        overtimeCreatorIds: detached.patch.overtimeCreatorIds,
      },
      repoint,
      leaves: movedLeaves,
    });
    if (detached.patch.creatorIds.length === 0) plan.emptied.push(`new:${root.shiftId}`);
  }

  for (const s of shifts) {
    // Soft-deleted docs are not skipped (see the re-point above); a real
    // tombstone carries no accounts, so detaching it is a no-op.
    if (isRoot(s) || handledBySplit.has(s.shiftId)) continue;
    if (s.startMs < cutoffMs) continue; // started before the archive: history
    const d = detachAccounts(s, ids);
    if (d.kind === 'delete') plan.deletes.push(s.shiftId);
    else if (d.kind === 'patch') {
      plan.patches.push({ shiftId: s.shiftId, patch: d.patch });
      if (d.patch.creatorIds.length === 0 && !s.isDeleted) plan.emptied.push(s.shiftId);
    }
  }

  return plan;
}
