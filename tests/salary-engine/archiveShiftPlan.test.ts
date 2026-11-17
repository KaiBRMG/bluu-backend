/**
 * Archiving a creator takes it off the schedule — `planArchiveShifts`.
 *
 * Lives with the salary tests because every decision here is a pay decision:
 * a shift's `creatorIds` sets the agent's wage tier, so the planner must never
 * touch a shift that started before the archive, and must split a recurring
 * series rather than edit its root (whose assignment is every occurrence's,
 * past ones included).
 */

import { planArchiveShifts, type PlanLeave, type PlanShift } from '@/lib/creators/archiveShiftPlan';
import type { ShiftRecurrence } from '@/types/firestore';

const C = 'creator-archived';
const X = 'creator-other';
const H = 3_600_000;
const DAY = 24 * H;

const at = (y: number, m: number, d: number, h = 0) => Date.UTC(y, m - 1, d, h);

function shift(over: Partial<PlanShift> & { shiftId: string; startMs: number }): PlanShift {
  return {
    userId: 'agent-1',
    endMs: over.startMs + 8 * H,
    wallClockStart: '09:00',
    wallClockEnd: '17:00',
    userTimezone: 'UTC',
    isRecurring: false,
    recurrence: null,
    seriesId: null,
    overrideDateMs: null,
    isDeleted: false,
    creatorIds: [C, X],
    overtimeCreatorIds: [],
    isOvertime: false,
    coverageOfferId: null,
    paysWage: true,
    createdBy: 'admin',
    ...over,
  };
}

function rule(over: Partial<ShiftRecurrence>): ShiftRecurrence {
  return { frequency: 'daily', interval: 1, daysOfWeek: [], endDate: null, count: null, parentShiftId: null, ...over };
}

/** A recurring root whose first occurrence is `startMs` at 09:00–17:00 UTC. */
const root = (shiftId: string, startMs: number, r: Partial<ShiftRecurrence>, over: Partial<PlanShift> = {}) =>
  shift({ shiftId, startMs, isRecurring: true, recurrence: rule(r), ...over });

// Archived at noon on Wednesday 4 Nov 2026 — mid-way through that day's 09:00 shift.
const CUTOFF = at(2026, 11, 4, 12);

const plan = (shifts: PlanShift[], leaves: PlanLeave[] = []) =>
  planArchiveShifts({ accountIds: [C], cutoffMs: CUTOFF, shifts, leaves });

describe('one-off shifts', () => {
  it('detaches the account from a shift that starts after the archive, overtime mark included', () => {
    const p = plan([shift({ shiftId: 'f', startMs: at(2026, 11, 6, 9), overtimeCreatorIds: [C] })]);
    expect(p.patches).toEqual([{ shiftId: 'f', patch: { creatorIds: [X], overtimeCreatorIds: [] } }]);
    expect(p.emptied).toEqual([]);
  });

  it('never touches a shift that started before the archive — it is pay history', () => {
    const p = plan([
      shift({ shiftId: 'past', startMs: at(2026, 11, 2, 9) }),
      // Under way at the archive instant (09:00–17:00, archived at 12:00).
      shift({ shiftId: 'live', startMs: at(2026, 11, 4, 9) }),
    ]);
    expect(p.patches).toEqual([]);
    expect(p.deletes).toEqual([]);
  });

  it('deletes a shift coverage built once its last account is gone', () => {
    const p = plan([shift({ shiftId: 'ot', startMs: at(2026, 11, 6, 9), creatorIds: [C], coverageOfferId: 'offer-1', isOvertime: true })]);
    expect(p.deletes).toEqual(['ot']);
  });

  it('keeps a rostered shift left with no account, and reports it', () => {
    const p = plan([shift({ shiftId: 'solo', startMs: at(2026, 11, 6, 9), creatorIds: [C] })]);
    expect(p.deletes).toEqual([]);
    expect(p.patches).toEqual([{ shiftId: 'solo', patch: { creatorIds: [], overtimeCreatorIds: [] } }]);
    expect(p.emptied).toEqual(['solo']);
  });

  it('detaches a soft-deleted override too — withdrawing the leave would restore it as it stands', () => {
    // An edited occurrence later released for leave: an override soft-deleted with its accounts intact.
    const p = plan([shift({ shiftId: 'released', startMs: at(2026, 11, 6, 9), seriesId: 'gone-root', overrideDateMs: at(2026, 11, 6), isDeleted: true })]);
    expect(p.patches).toEqual([{ shiftId: 'released', patch: { creatorIds: [X], overtimeCreatorIds: [] } }]);
  });

  it('ignores a shift that does not hold the account', () => {
    expect(plan([shift({ shiftId: 'n', startMs: at(2026, 11, 6, 9), creatorIds: [X] })]).patches).toEqual([]);
  });

  it('a hand-built overtime shift stays all-overtime (no tier drop for the remaining accounts)', () => {
    const p = plan([shift({ shiftId: 'h', startMs: at(2026, 11, 6, 9), isOvertime: true, overtimeCreatorIds: [C, X] })]);
    expect(p.patches[0].patch).toEqual({ creatorIds: [X], overtimeCreatorIds: [X] });
  });
});

describe('recurring series', () => {
  it('a series not yet started is patched in place', () => {
    const p = plan([root('r', at(2026, 11, 9, 9), { frequency: 'daily' })]);
    expect(p.splits).toEqual([]);
    expect(p.patches).toEqual([{ shiftId: 'r', patch: { creatorIds: [X], overtimeCreatorIds: [] } }]);
  });

  it('a series under way is split at the first occurrence after the archive, not edited', () => {
    const p = plan([root('r', at(2026, 11, 1, 9), { frequency: 'daily' })]);
    expect(p.patches).toEqual([]);
    expect(p.splits).toHaveLength(1);
    const s = p.splits[0];
    // 4 Nov's occurrence (09:00) started before the noon archive — it stays with the old root.
    expect(s.truncateAtMs).toBe(at(2026, 11, 5));
    expect(s.newRoot.startMs).toBe(at(2026, 11, 5, 9));
    expect(s.newRoot.endMs).toBe(at(2026, 11, 5, 17));
    expect(s.newRoot.creatorIds).toEqual([X]);
    expect(s.newRoot.recurrence?.count).toBeNull();
  });

  it('a counted series carries only the occurrences it has left', () => {
    // 10 daily from 1 Nov: 1–4 Nov already emitted, 6 remain.
    const p = plan([root('r', at(2026, 11, 1, 9), { frequency: 'daily', count: 10 })]);
    expect(p.splits[0].newRoot.recurrence?.count).toBe(6);
  });

  it('a counted series that has already run out is left alone', () => {
    const p = plan([root('r', at(2026, 10, 20, 9), { frequency: 'daily', count: 3 })]);
    expect(p.splits).toEqual([]);
    expect(p.patches).toEqual([]);
  });

  it('a fortnightly roster keeps its phase — split on an "on" week', () => {
    // Mondays, every other week, from Mon 2 Nov: 2, 16, 30 Nov. Archived 4 Nov.
    const p = plan([root('r', at(2026, 11, 2, 9), { frequency: 'weekly', interval: 2, daysOfWeek: [1] })]);
    expect(p.splits[0].truncateAtMs).toBe(at(2026, 11, 16));
    expect(p.splits[0].newRoot.startMs).toBe(at(2026, 11, 16, 9));
  });

  it('re-points overrides and tombstones on/after the split to the new root, detaching future overrides', () => {
    const r = root('r', at(2026, 11, 1, 9), { frequency: 'daily' });
    const before = shift({ shiftId: 'o-before', startMs: at(2026, 11, 3, 10), seriesId: 'r', overrideDateMs: at(2026, 11, 3) });
    const after = shift({ shiftId: 'o-after', startMs: at(2026, 11, 7, 10), seriesId: 'r', overrideDateMs: at(2026, 11, 7) });
    const tomb = shift({ shiftId: 't-after', startMs: at(2026, 11, 8), seriesId: 'r', overrideDateMs: at(2026, 11, 8), isDeleted: true, creatorIds: [] });
    const p = plan([r, before, after, tomb]);

    expect(p.splits[0].repoint).toEqual([
      { shiftId: 'o-after', patch: { creatorIds: [X], overtimeCreatorIds: [] } },
      { shiftId: 't-after', patch: null },
    ]);
    // The override before the split is history; it is neither moved nor patched.
    expect(p.patches).toEqual([]);
  });

  it('moves approved leave released on a re-pointed date, and nothing else', () => {
    const r = root('r', at(2026, 11, 1, 9), { frequency: 'daily' });
    const leaves: PlanLeave[] = [
      { leaveId: 'approved-after', status: 'approved', shiftId: 'r', occurrenceStart: at(2026, 11, 8, 9), releasedShiftId: 'r', releasedOccurrenceStart: at(2026, 11, 8, 9) },
      { leaveId: 'legacy-after', status: 'approved', shiftId: 'r', occurrenceStart: at(2026, 11, 9, 9), releasedShiftId: null, releasedOccurrenceStart: null },
      { leaveId: 'pending-after', status: 'pending', shiftId: 'r', occurrenceStart: at(2026, 11, 10, 9), releasedShiftId: null, releasedOccurrenceStart: null },
      { leaveId: 'approved-before', status: 'approved', shiftId: 'r', occurrenceStart: at(2026, 11, 3, 9), releasedShiftId: 'r', releasedOccurrenceStart: at(2026, 11, 3, 9) },
      { leaveId: 'other-series', status: 'approved', shiftId: 'q', occurrenceStart: at(2026, 11, 8, 9), releasedShiftId: 'q', releasedOccurrenceStart: at(2026, 11, 8, 9) },
    ];
    expect(plan([r], leaves).splits[0].leaves).toEqual([
      { leaveId: 'approved-after', releasedOccurrenceStart: at(2026, 11, 8, 9) },
      { leaveId: 'legacy-after', releasedOccurrenceStart: at(2026, 11, 9, 9) },
    ]);
  });

  it('is idempotent: the truncated root and the new root plan nothing on a re-run', () => {
    const first = plan([root('r', at(2026, 11, 1, 9), { frequency: 'daily' })]).splits[0];
    const endDate = { toMillis: () => first.truncateAtMs - DAY } as unknown as ShiftRecurrence['endDate'];
    const truncated = root('r', at(2026, 11, 1, 9), { frequency: 'daily', endDate });
    const created = shift({ ...first.newRoot, shiftId: 'r2' });
    const again = plan([truncated, created]);
    expect(again.splits).toEqual([]);
    expect(again.patches).toEqual([]);
  });

  it('honours the series timezone when choosing the split date', () => {
    // 22:00–06:00 in Harare (UTC+2) = 20:00–04:00 UTC. Archived 4 Nov 21:00 UTC:
    // 4 Nov's occurrence started 20:00 UTC, before the archive — the split is 5 Nov local.
    const r = root('r', at(2026, 11, 1, 20), { frequency: 'daily' }, { wallClockStart: '22:00', wallClockEnd: '06:00', userTimezone: 'Africa/Harare' });
    const p = planArchiveShifts({ accountIds: [C], cutoffMs: at(2026, 11, 4, 21), shifts: [r], leaves: [] });
    expect(p.splits[0].truncateAtMs).toBe(at(2026, 11, 5));
    expect(p.splits[0].newRoot.startMs).toBe(at(2026, 11, 5, 20));
    expect(p.splits[0].newRoot.endMs).toBe(at(2026, 11, 6, 4));
  });
});

describe('sub-accounts go with their creator', () => {
  it('detaches every id passed', () => {
    const p = planArchiveShifts({
      accountIds: [C, 'sub-1'],
      cutoffMs: CUTOFF,
      shifts: [shift({ shiftId: 'f', startMs: at(2026, 11, 6, 9), creatorIds: [C, 'sub-1', X] })],
      leaves: [],
    });
    expect(p.patches[0].patch.creatorIds).toEqual([X]);
  });
});
