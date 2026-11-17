/**
 * "Edit this and future" — the split a series needs so nothing before the
 * chosen occurrence changes and nothing after it is lost or doubled.
 */

import { findSeriesSplitAtDate } from '@/lib/utils/recurrence';
import { docsMovedBySplit, leavesMovedBySplit, remainingCount, type SplitLeave } from '@/lib/shifts/seriesSplitPlan';
import type { ShiftRecurrence } from '@/types/firestore';

const at = (y: number, m: number, d: number, h = 0) => Date.UTC(y, m - 1, d, h);

function rule(over: Partial<ShiftRecurrence>): ShiftRecurrence {
  return { frequency: 'daily', interval: 1, daysOfWeek: [], endDate: null, count: null, parentShiftId: null, ...over };
}

const root = (startMs: number, r: Partial<ShiftRecurrence>, tz = 'UTC') => ({
  startTimeMs: startMs,
  wallClockStart: '09:00',
  wallClockEnd: '17:00',
  userTimezone: tz,
  recurrence: rule(r),
});

describe('findSeriesSplitAtDate', () => {
  it('splits on the chosen occurrence and counts what ran before it', () => {
    const s = findSeriesSplitAtDate(root(at(2026, 11, 1, 9), { count: 10 }), '2026-11-05');
    expect(s?.date).toBe('2026-11-05');
    expect(s?.before).toBe(4);
    expect(s?.overrideDateMs).toBe(at(2026, 11, 5));
    expect(s?.occurrenceStart).toBe(at(2026, 11, 5, 9));
  });

  it('a 10-occurrence roster edited at its 5th keeps 6, not 10', () => {
    const s = findSeriesSplitAtDate(root(at(2026, 11, 1, 9), { count: 10 }), '2026-11-05')!;
    expect(remainingCount(10, s.before)).toBe(6);
  });

  it('edited at its first occurrence, the whole count carries over', () => {
    const s = findSeriesSplitAtDate(root(at(2026, 11, 1, 9), { count: 10 }), '2026-11-01')!;
    expect(s.before).toBe(0);
    expect(remainingCount(10, s.before)).toBe(10);
  });

  it('counts a weekly roster by its occurrences, not its days', () => {
    // Mon + Thu from Mon 2 Nov: 2, 5, 9, 12 Nov before Mon 16 Nov.
    const s = findSeriesSplitAtDate(root(at(2026, 11, 2, 9), { frequency: 'weekly', daysOfWeek: [1, 4] }), '2026-11-16');
    expect(s?.date).toBe('2026-11-16');
    expect(s?.before).toBe(4);
  });

  it('returns null once the series has run out', () => {
    expect(findSeriesSplitAtDate(root(at(2026, 11, 1, 9), { count: 3 }), '2026-11-05')).toBeNull();
  });

  it('reads the date in the series timezone', () => {
    // 22:00 in Harare = 20:00 UTC; the 5 Nov local occurrence starts 5 Nov 20:00 UTC.
    const s = findSeriesSplitAtDate(
      { ...root(at(2026, 11, 1, 20), {}, 'Africa/Harare'), wallClockStart: '22:00', wallClockEnd: '06:00' },
      '2026-11-05',
    );
    expect(s?.occurrenceStart).toBe(at(2026, 11, 5, 20));
    expect(s?.occurrenceEnd).toBe(at(2026, 11, 6, 4));
  });
});

describe('remainingCount', () => {
  it('an unlimited rule stays unlimited', () => {
    expect(remainingCount(null, 7)).toBeNull();
  });
});

describe('docsMovedBySplit', () => {
  it('moves this series’ overrides and tombstones on or after the split, and nothing else', () => {
    const docs = [
      { shiftId: 'before', seriesId: 'r', overrideDateMs: at(2026, 11, 4) },
      { shiftId: 'on', seriesId: 'r', overrideDateMs: at(2026, 11, 5) },
      { shiftId: 'after', seriesId: 'r', overrideDateMs: at(2026, 11, 9) },
      { shiftId: 'other-series', seriesId: 'q', overrideDateMs: at(2026, 11, 9) },
    ];
    expect(docsMovedBySplit(docs, 'r', at(2026, 11, 5)).map(d => d.shiftId)).toEqual(['on', 'after']);
  });
});

describe('handing the series to another agent (A → B)', () => {
  const docs = [
    { shiftId: 'a-leave-tomb', userId: 'A', seriesId: 'r', overrideDateMs: at(2026, 11, 8) },
    { shiftId: 'a-edit', userId: 'A', seriesId: 'r', overrideDateMs: at(2026, 11, 9) },
    { shiftId: 'given-to-c', userId: 'C', seriesId: 'r', overrideDateMs: at(2026, 11, 10) },
  ];

  it("leaves A's own edits and tombstones on A's series; a day given to C still moves", () => {
    expect(docsMovedBySplit(docs, 'r', at(2026, 11, 5), 'A').map(d => d.shiftId)).toEqual(['given-to-c']);
  });

  it('moves everything when the agent is unchanged', () => {
    expect(docsMovedBySplit(docs, 'r', at(2026, 11, 5))).toHaveLength(3);
  });

  it("does not move A's approved leave — it stays with the tombstone it wrote", () => {
    const leaves: SplitLeave[] = [
      { leaveId: 'a', userId: 'A', status: 'approved', shiftId: 'r', occurrenceStart: at(2026, 11, 8, 9), releasedShiftId: 'r', releasedOccurrenceStart: at(2026, 11, 8, 9) },
    ];
    expect(leavesMovedBySplit(leaves, 'r', at(2026, 11, 5, 9), 'A')).toEqual([]);
    expect(leavesMovedBySplit(leaves, 'r', at(2026, 11, 5, 9))).toHaveLength(1);
  });
});

describe('leavesMovedBySplit', () => {
  it('moves approved leave released on a moved date, legacy leave by its pin', () => {
    const leaves: SplitLeave[] = [
      { leaveId: 'after', status: 'approved', shiftId: 'r', occurrenceStart: at(2026, 11, 8, 9), releasedShiftId: 'r', releasedOccurrenceStart: at(2026, 11, 8, 9) },
      { leaveId: 'legacy', status: 'approved', shiftId: 'r', occurrenceStart: at(2026, 11, 9, 9), releasedShiftId: null, releasedOccurrenceStart: null },
      { leaveId: 'pending', status: 'pending', shiftId: 'r', occurrenceStart: at(2026, 11, 10, 9), releasedShiftId: null, releasedOccurrenceStart: null },
      { leaveId: 'before', status: 'approved', shiftId: 'r', occurrenceStart: at(2026, 11, 3, 9), releasedShiftId: 'r', releasedOccurrenceStart: at(2026, 11, 3, 9) },
      // Released an edited occurrence: the override keeps its id, so the leave needs nothing.
      { leaveId: 'override', status: 'approved', shiftId: 'r', occurrenceStart: at(2026, 11, 8, 9), releasedShiftId: 'ovr-1', releasedOccurrenceStart: at(2026, 11, 8, 10) },
    ];
    expect(leavesMovedBySplit(leaves, 'r', at(2026, 11, 5, 9))).toEqual([
      { leaveId: 'after', releasedOccurrenceStart: at(2026, 11, 8, 9) },
      { leaveId: 'legacy', releasedOccurrenceStart: at(2026, 11, 9, 9) },
    ]);
  });
});
