/**
 * Monday-first week arithmetic.
 *
 * `ShiftCalendar`'s week view is anchored entirely on `startOfWeek`, and its
 * weekday header row is fixed Mon→Sun. If the two ever disagree, a shift renders
 * under the wrong weekday — which on a roster reads as "you are on Tuesday" when
 * you are on Monday, and nothing about it looks broken.
 *
 * Three things are pinned here: the anchor is Monday (not Sunday, which is what
 * `dayOfWeek` returns 0 for), a week is exactly seven ascending days, and both
 * survive a month boundary — the one case the month grid never has to handle.
 */

import {
  addDays,
  dayOfWeek,
  enumerateWeekDays,
  monthOfDay,
  startOfWeek,
} from '@/lib/salary/salaryDate';

describe('startOfWeek', () => {
  it('anchors on Monday, not Sunday', () => {
    // 2026-09-14 is a Monday.
    expect(startOfWeek('2026-09-14')).toBe('2026-09-14');
    expect(startOfWeek('2026-09-16')).toBe('2026-09-14');
    // Sunday belongs to the week that started six days earlier, not the next one.
    expect(startOfWeek('2026-09-20')).toBe('2026-09-14');
    expect(startOfWeek('2026-09-21')).toBe('2026-09-21');
  });

  it('is idempotent, and always lands on a Monday', () => {
    for (let i = 0; i < 400; i++) {
      const day = addDays('2026-01-01', i);
      const start = startOfWeek(day);
      expect(dayOfWeek(start)).toBe(1);
      expect(startOfWeek(start)).toBe(start);
      expect(start <= day).toBe(true);
    }
  });

  it('crosses a month, a year and a leap day', () => {
    expect(startOfWeek('2026-10-01')).toBe('2026-09-28');
    expect(startOfWeek('2027-01-01')).toBe('2026-12-28');
    // 2028 is a leap year; 29 Feb is a Tuesday.
    expect(startOfWeek('2028-02-29')).toBe('2028-02-28');
  });
});

describe('enumerateWeekDays', () => {
  it('returns seven ascending days starting at the anchor', () => {
    expect(enumerateWeekDays('2026-09-14')).toEqual([
      '2026-09-14',
      '2026-09-15',
      '2026-09-16',
      '2026-09-17',
      '2026-09-18',
      '2026-09-19',
      '2026-09-20',
    ]);
  });

  it('spans the month boundary the week view has to draw', () => {
    const week = enumerateWeekDays(startOfWeek('2026-10-01'));
    expect(week).toHaveLength(7);
    // Exactly the case `useShiftCalendar` fetches two months for.
    expect(new Set(week.map(monthOfDay))).toEqual(new Set(['2026-09', '2026-10']));
  });
});
