/**
 * Chat-agent salary — the engine.
 *
 * This is the money path: every figure a chat agent is paid comes out of
 * `computeSalaryMonth`. The engine is pure, so it is cheap to pin exactly.
 *
 * Run: `cd tests/salary-engine && npm install && npm test`
 *
 * When a rule genuinely changes, change the assertion **and** the rule's entry
 * in documentation/ca-salary.md in the same commit.
 */

import {
  computeSalaryMonth,
  DEFAULT_SALARY_CONFIG,
  payableHoursFor,
  hourlyRateFor,
  tierPercentFor,
  computeTierProgress,
  round2,
} from '@/lib/salary/salaryEngine';
import {
  toDayKey,
  toMonthKey,
  enumerateMonthDays,
  addMonths,
  daysInMonth,
} from '@/lib/salary/salaryDate';
import type { SalaryDayInput, SalaryShiftInput } from '@/lib/salary/salaryTypes';

const C = DEFAULT_SALARY_CONFIG;
const H = 3600;

function shift(over: Partial<SalaryShiftInput> = {}): SalaryShiftInput {
  return {
    shiftId: 's1',
    occurrenceStart: 0,
    scheduledHours: 8,
    trackedSeconds: 8 * H,
    creatorIds: ['c1', 'c2', 'c3'],
    isOvertime: false,
    paysWage: true,
    ...over,
  };
}

function day(over: Partial<SalaryDayInput> = {}): SalaryDayInput {
  return {
    day: '2026-09-01',
    grossEarnings: 0,
    saleCount: 0,
    salesCreatorNames: [],
    shifts: [],
    ...over,
  };
}

const month = (days: SalaryDayInput[], overrides: Parameters<typeof computeSalaryMonth>[0]['overrides'] = [], config = C) =>
  computeSalaryMonth({ userId: 'u', month: '2026-09', days, overrides, config });

// ─── Rounding ────────────────────────────────────────────────────────

describe('round2', () => {
  // `n * 100` gives 100.49999999999999 for 1.005 — the cent payroll argues about.
  it.each([
    [1.005, 1.01],
    [-1.005, -1.01],
    [2.675, 2.68],
    [0.145, 0.15],
    [-0.125, -0.13],
    [1234.565, 1234.57],
    [0, 0],
    [1e-9, 0],
  ])('rounds %p to %p', (input, expected) => {
    expect(round2(input)).toBe(expected);
  });
});

// ─── Tiers ───────────────────────────────────────────────────────────

describe('commission tiers', () => {
  it.each([
    [0, 2.5],
    [3999, 2.5],
    [4000, 3],
    [7999, 3],
    [8000, 4],
    [11999, 4],
    [12000, 5],
    [999999, 5],
  ])('month-to-date %p earns %p%%', (gross, percent) => {
    expect(tierPercentFor(gross, C)).toBe(percent);
  });

  it('falls to the floor tier rather than zero when a reversal goes negative', () => {
    expect(tierPercentFor(-500, C)).toBe(2.5);
  });

  it('reports the distance to the next threshold, and null at the top', () => {
    expect(computeTierProgress(3000, C).grossToNext).toBe(1000);
    expect(computeTierProgress(12500, C).grossToNext).toBeNull();
    expect(computeTierProgress(12500, C).nextPercent).toBeNull();
  });
});

// ─── Hours ───────────────────────────────────────────────────────────

describe('payable hours', () => {
  it('credits the grace period to every worked shift', () => {
    expect(payableHoursFor(5 * H, 8, C)).toBe(5.25);
    expect(payableHoursFor(7 * H + 40 * 60, 8, C)).toBe(7.92);
  });

  it('caps at the shift’s own scheduled length, not a fixed eight hours', () => {
    expect(payableHoursFor(7 * H + 50 * 60, 8, C)).toBe(8);
    expect(payableHoursFor(4 * H, 4, C)).toBe(4);
  });

  it('pays nothing for a shift with no tracked time — grace is not an absence allowance', () => {
    expect(payableHoursFor(0, 8, C)).toBe(0);
  });
});

// ─── Wage tiers ──────────────────────────────────────────────────────

describe('hourly rate', () => {
  it('maps account counts to rates', () => {
    expect([1, 2, 3, 4, 5].map(n => hourlyRateFor(n, C))).toEqual([1.5, 2.5, 3.5, 4.5, 5.5]);
  });

  it('clamps above the highest tier rather than extrapolating', () => {
    expect(hourlyRateFor(9, C)).toBe(5.5);
  });

  it('pays nothing for zero accounts', () => {
    expect(hourlyRateFor(0, C)).toBe(0);
  });
});

// ─── A day ───────────────────────────────────────────────────────────

describe('a single day', () => {
  const result = month([day({ grossEarnings: 500, saleCount: 4, shifts: [shift()] })]);
  const d = result.days[0];

  it('takes 20% off before commission', () => {
    expect(d.netEarnings).toBe(400);
  });

  it('earns the tier rate on the net', () => {
    expect(d.commissionPercent).toBe(2.5);
    expect(d.commission).toBe(10);
  });

  it('pays hours at the rate the account count sets', () => {
    expect(d.accountCount).toBe(3);
    expect(d.accountCountSource).toBe('shift');
    expect(d.hourlyRate).toBe(3.5);
    expect(d.wage).toBe(28);
  });

  it('sums commission and wage into the salary', () => {
    expect(d.salary).toBe(38);
  });
});

// ─── Reversals ───────────────────────────────────────────────────────

describe('reversals', () => {
  const result = month([
    day({ day: '2026-09-01', grossEarnings: 100, saleCount: 1 }),
    day({ day: '2026-09-02', grossEarnings: -40, saleCount: 1 }),
  ]);

  it('lets a day go negative', () => {
    expect(result.days[1].grossEarnings).toBe(-40);
    expect(result.days[1].commission).toBeLessThan(0);
  });

  it('reduces the month-to-date total that drives the tier', () => {
    expect(result.totals.grossEarnings).toBe(60);
  });
});

// ─── The ratchet ─────────────────────────────────────────────────────

describe('the commission ratchet', () => {
  const result = month([
    day({ day: '2026-09-01', grossEarnings: 3900, saleCount: 1 }),
    day({ day: '2026-09-02', grossEarnings: 200, saleCount: 1 }),
    day({ day: '2026-09-03', grossEarnings: 100, saleCount: 1 }),
  ]);

  it('applies the new rate from the day the threshold is crossed', () => {
    expect(result.days[1].commissionPercent).toBe(3);
  });

  it('never restates a day earned at the old rate', () => {
    expect(result.days[0].commissionPercent).toBe(2.5);
  });

  it('keeps the new rate for the rest of the month', () => {
    expect(result.days[2].commissionPercent).toBe(3);
  });
});

// ─── Overrides ───────────────────────────────────────────────────────

describe('admin overrides', () => {
  it('recomputes downstream of the edited field', () => {
    const result = month(
      [day({ grossEarnings: 500, saleCount: 1, shifts: [shift({ trackedSeconds: 4 * H, creatorIds: ['c1', 'c2'] })] })],
      [{ day: '2026-09-01', userId: 'u', fields: { hours: { value: 8, setBy: 'admin', setAt: 'x' } } }],
    );
    const d = result.days[0];

    expect(d.hours).toBe(8);
    expect(d.wage).toBe(20); // 8h at the 2-account rate
    expect(d.commission).toBe(10); // untouched — not downstream of hours
  });

  it('keeps what the engine would have said, so the edit can be reverted', () => {
    const result = month(
      [day({ shifts: [shift({ trackedSeconds: 4 * H })] })],
      [{ day: '2026-09-01', userId: 'u', fields: { hours: { value: 8, setBy: 'admin', setAt: 'x' } } }],
    );
    expect(result.days[0].overrides.hours?.computed).toBe(4.25);
  });

  // The reason override endpoints return the whole recomputed month rather than
  // letting the client patch a cell.
  it('re-tiers every LATER day when gross is overridden', () => {
    const result = month(
      [
        day({ day: '2026-09-01', grossEarnings: 100, saleCount: 1 }),
        day({ day: '2026-09-02', grossEarnings: 100, saleCount: 1 }),
      ],
      [{ day: '2026-09-01', userId: 'u', fields: { grossEarnings: { value: 4000, setBy: 'a', setAt: 'x' } } }],
    );
    expect(result.days[0].commissionPercent).toBe(3);
    expect(result.days[1].commissionPercent).toBe(3);
  });
});

// ─── Overtime ────────────────────────────────────────────────────────

describe('overtime', () => {
  it('adds neither hours nor accounts when cover sits inside an existing shift', () => {
    const result = month([
      day({
        shifts: [
          shift({ creatorIds: ['c1', 'c2'] }),
          shift({ shiftId: 's2', creatorIds: ['c9'], isOvertime: true, paysWage: false }),
        ],
      }),
    ]);
    const d = result.days[0];

    expect(d.accountCount).toBe(2);
    expect(d.hours).toBe(8);
    expect(d.wage).toBe(20);
  });

  it('rates each shift on its own accounts by default', () => {
    const result = month([
      day({
        shifts: [
          shift({ creatorIds: ['c1', 'c2', 'c3'] }),
          shift({ shiftId: 's2', scheduledHours: 4, trackedSeconds: 4 * H, creatorIds: ['c9', 'c8'], isOvertime: true }),
        ],
      }),
    ]);

    expect(result.days[0].hours).toBe(12);
    expect(result.days[0].wage).toBe(38); // 8×3.50 + 4×2.50
  });

  it('rates every hour on the day’s total accounts under the per-day basis', () => {
    const result = month(
      [
        day({
          shifts: [
            shift({ creatorIds: ['c1', 'c2', 'c3'] }),
            shift({ shiftId: 's2', scheduledHours: 4, trackedSeconds: 4 * H, creatorIds: ['c9', 'c8'], isOvertime: true }),
          ],
        }),
      ],
      [],
      { ...C, wageRateBasis: 'per-day' },
    );

    expect(result.days[0].wage).toBe(66); // 12h at the 5-account rate
  });
});

// ─── Missing data ────────────────────────────────────────────────────

describe('sales with no shift on record', () => {
  const result = month([day({ grossEarnings: 300, saleCount: 3, salesCreatorNames: ['A', 'B', 'A'] })]);
  const d = result.days[0];

  it('is flagged rather than silently paid as zero hours', () => {
    expect(d.missingShift).toBe(true);
  });

  it('infers the account count from distinct creators sold for, and says so', () => {
    expect(d.accountCount).toBe(2);
    expect(d.accountCountSource).toBe('sales');
  });

  it('still pays no wage, because hours cannot be derived', () => {
    expect(d.wage).toBe(0);
  });
});

// ─── Shape ───────────────────────────────────────────────────────────

describe('the month grid', () => {
  it('has a row per calendar day, worked or not', () => {
    expect(month([]).days).toHaveLength(30);
    expect(computeSalaryMonth({ userId: 'u', month: '2026-02', days: [], overrides: [], config: C }).days).toHaveLength(28);
    expect(computeSalaryMonth({ userId: 'u', month: '2024-02', days: [], overrides: [], config: C }).days).toHaveLength(29);
  });

  it('totals equal the sum of the visible rows', () => {
    const result = month([
      day({ day: '2026-09-01', grossEarnings: 333.33, saleCount: 1, shifts: [shift()] }),
      day({ day: '2026-09-02', grossEarnings: 666.67, saleCount: 1, shifts: [shift()] }),
    ]);
    const summed = result.days.reduce((sum, d) => round2(sum + d.salary), 0);
    expect(summed).toBe(result.totals.salary);
  });
});

// ─── Dates ───────────────────────────────────────────────────────────

describe('salary dates', () => {
  it('keeps a late-evening sale on its own Harare day', () => {
    // 00:08 CAT on the 1st is 22:08 UTC on the 31st — the bug a naive UTC
    // bucketing would introduce.
    const ms = Date.UTC(2026, 6, 31, 22, 8, 11);
    expect(toDayKey(ms)).toBe('2026-08-01');
    expect(toMonthKey(ms)).toBe('2026-08');
  });

  it('enumerates and steps months correctly across year boundaries', () => {
    expect(enumerateMonthDays('2026-09')).toHaveLength(30);
    expect(enumerateMonthDays('2026-09')[0]).toBe('2026-09-01');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(addMonths('2026-12', 1)).toBe('2027-01');
    expect(daysInMonth('2024-02')).toBe(29);
  });
});
