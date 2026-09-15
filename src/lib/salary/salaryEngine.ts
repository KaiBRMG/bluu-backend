/**
 * The salary computation. Pure, synchronous, and the only place the money rules
 * live — the API, the admin grid and the agent's dashboard all read the same
 * output, so a rule can never be implemented twice and drift.
 *
 * ## The chain
 *
 * Every figure is derived, never stored:
 *
 * ```
 *   gross ─→ net ─→ ┐
 *      └─→ cumulative ─→ tier % ─→ commission ─┐
 *                                              ├─→ salary
 *   tracked ─→ +grace ─→ capped hours ──┐      │
 *   accounts ─→ hourly rate ────────────┴─→ wage
 * ```
 *
 * An admin override replaces one node and everything downstream recomputes,
 * unless the downstream node is itself overridden. That is the whole reason the
 * engine recomputes on every read rather than storing rows: a re-import, a rate
 * change or a corrected shift flows through automatically, and an admin's edit
 * survives all three.
 *
 * ## The ratchet
 *
 * The commission tier is read from **month-to-date gross including the current
 * day**, so the day a threshold is crossed earns the new rate. Because days are
 * walked in order and each keeps the rate it was computed at, earlier days are
 * never restated — which is the behaviour the spreadsheet had and the thing
 * agents check first.
 */

import {
  DEFAULT_COMMISSION_TIERS,
  DEFAULT_DEDUCTION_RATE,
  DEFAULT_GRACE_MINUTES,
  DEFAULT_SHIFT_HOURS,
  DEFAULT_WAGE_TIERS,
} from './salaryConstants';
import { enumerateMonthDays } from './salaryDate';
import type {
  AccountCountSource,
  SalaryConfig,
  SalaryDayInput,
  SalaryDayResult,
  SalaryMonthInput,
  SalaryMonthResult,
  SalaryMonthTotals,
  SalaryOverrideField,
  SalaryShiftBreakdown,
  SalaryTierProgress,
} from './salaryTypes';

/** The rate table as shipped. Firestore overrides it; this is the fallback. */
export const DEFAULT_SALARY_CONFIG: SalaryConfig = {
  deductionRate: DEFAULT_DEDUCTION_RATE,
  commissionTiers: DEFAULT_COMMISSION_TIERS,
  wageTiers: DEFAULT_WAGE_TIERS,
  graceMinutes: DEFAULT_GRACE_MINUTES,
  defaultShiftHours: DEFAULT_SHIFT_HOURS,
  wageRateBasis: 'per-shift',
  updatedBy: null,
  updatedAt: null,
};

/**
 * Move a number by `places` decimal digits via its exponential form.
 *
 * `n * 100` is the obvious way and it is wrong: `1.005 * 100` is
 * `100.49999999999999` in binary floating point, so the cent that payroll is
 * arguing about rounds the wrong way. Re-exponentiating the decimal string has
 * no such gap, and unlike a fixed `Number.EPSILON` nudge it stays correct at
 * every magnitude.
 */
function shiftDecimal(n: number, places: number): number {
  if (n === 0 || !Number.isFinite(n)) return 0;
  const [mantissa, exponent] = n.toExponential().split('e');
  return Number(`${mantissa}e${Number(exponent) + places}`);
}

/**
 * Round to cents, halves away from zero.
 *
 * Applied at every money node rather than only at the total, because the agent
 * reads a column and adds it up by eye — a total that does not equal the visible
 * rows is read as a bug even when it is more precise.
 */
export function round2(n: number): number {
  if (!Number.isFinite(n)) return 0;
  const sign = n < 0 ? -1 : 1;
  return sign * shiftDecimal(Math.round(shiftDecimal(Math.abs(n), 2)), -2);
}

/** Round hours to two decimals — 7.75 reads as three quarters, 7.7499999 does not. */
function round2h(n: number): number {
  return round2(n);
}

/**
 * The commission percentage for a given month-to-date gross.
 *
 * Tiers are scanned descending so the highest qualifying band wins regardless of
 * how the table is ordered in config. A negative month-to-date (possible after a
 * large reversal early in a month) falls to the lowest tier rather than to zero —
 * the agent is still on the scale, just at its floor.
 */
export function tierPercentFor(cumulativeGross: number, config: SalaryConfig): number {
  const tiers = [...config.commissionTiers].sort((a, b) => a.minGross - b.minGross);
  if (tiers.length === 0) return 0;

  let percent = tiers[0].percent;
  for (const tier of tiers) {
    if (cumulativeGross >= tier.minGross) percent = tier.percent;
    else break;
  }
  return percent;
}

/**
 * Where the agent stands on the sliding scale, and what the next step costs.
 *
 * This is the secondary figure on the dashboard card, so it has to answer "how
 * much more" in one number. At the top tier `nextPercent` and `grossToNext` are
 * both null — the card renders "top tier" rather than an unreachable target.
 */
export function computeTierProgress(cumulativeGross: number, config: SalaryConfig): SalaryTierProgress {
  const tiers = [...config.commissionTiers].sort((a, b) => a.minGross - b.minGross);
  if (tiers.length === 0) {
    return { currentPercent: 0, nextPercent: null, grossToNext: null, progress: 1, tierFloor: 0, tierCeiling: null };
  }

  let index = 0;
  for (let i = 0; i < tiers.length; i++) {
    if (cumulativeGross >= tiers[i].minGross) index = i;
  }

  const current = tiers[index];
  const next = index + 1 < tiers.length ? tiers[index + 1] : null;
  const tierFloor = current.minGross;
  const tierCeiling = next ? next.minGross : null;

  let progress = 1;
  if (tierCeiling !== null) {
    const band = tierCeiling - tierFloor;
    progress = band > 0 ? Math.min(1, Math.max(0, (cumulativeGross - tierFloor) / band)) : 1;
  }

  return {
    currentPercent: current.percent,
    nextPercent: next ? next.percent : null,
    grossToNext: next ? round2(Math.max(0, next.minGross - cumulativeGross)) : null,
    progress,
    tierFloor,
    tierCeiling,
  };
}

/**
 * The hourly rate for a number of accounts.
 *
 * Clamps rather than interpolates: a count above the highest tier pays the
 * highest rate, a count below the lowest pays the lowest. Zero accounts pays
 * nothing at all — a shift with no accounts assigned is not a shift that was
 * worked, and paying it would quietly reward a missing assignment.
 */
export function hourlyRateFor(accountCount: number, config: SalaryConfig): number {
  if (accountCount <= 0) return 0;

  const keys = Object.keys(config.wageTiers)
    .map(Number)
    .filter(n => Number.isFinite(n))
    .sort((a, b) => a - b);
  if (keys.length === 0) return 0;

  const clamped = Math.min(Math.max(accountCount, keys[0]), keys[keys.length - 1]);

  // Highest tier at or below the clamped count.
  let rate = config.wageTiers[keys[0]];
  for (const key of keys) {
    if (clamped >= key) rate = config.wageTiers[key];
    else break;
  }
  return rate;
}

/**
 * Payable hours for one shift: worked time plus the grace credit, capped at the
 * shift's scheduled length.
 *
 * The grace is credited to every worked shift, not only to one that nearly
 * reached full length — a half day gets 15 minutes too. A shift with no tracked
 * time at all gets nothing: grace forgives a short shift, it does not pay for an
 * absence.
 */
export function payableHoursFor(trackedSeconds: number, scheduledHours: number, config: SalaryConfig): number {
  if (trackedSeconds <= 0) return 0;
  const tracked = trackedSeconds / 3600;
  const cap = scheduledHours > 0 ? scheduledHours : config.defaultShiftHours;
  return round2h(Math.min(cap, tracked + config.graceMinutes / 60));
}

// ─── The month ───────────────────────────────────────────────────────

interface OverrideLookup {
  fields: Partial<Record<SalaryOverrideField, { value: number; setBy: string; setByName?: string; setAt: string; reason?: string }>>;
  note?: string | null;
}

/**
 * Compute a whole month for one agent.
 *
 * Always returns a row per calendar day, worked or not — the sheet it replaces
 * had one, and a gap in the dates reads as missing data rather than as a day
 * off. Days are walked in ascending order because the tier ratchet depends on
 * it; do not reorder.
 */
export function computeSalaryMonth(input: SalaryMonthInput): SalaryMonthResult {
  const { userId, month, config } = input;

  const byDay = new Map<string, SalaryDayInput>();
  for (const day of input.days) byDay.set(day.day, day);

  const overrideByDay = new Map<string, OverrideLookup>();
  for (const o of input.overrides) {
    overrideByDay.set(o.day, { fields: o.fields, note: o.note });
  }

  const results: SalaryDayResult[] = [];
  let cumulativeGross = 0;

  for (const dayKey of enumerateMonthDays(month)) {
    const day = byDay.get(dayKey);
    const override = overrideByDay.get(dayKey);
    const fields = override?.fields ?? {};

    // Track what the engine would have said, so every override can show its
    // original beside it and offer a revert.
    const computed: Partial<Record<SalaryOverrideField, number>> = {};

    // ── Gross → net ──
    const computedGross = round2(day?.grossEarnings ?? 0);
    computed.grossEarnings = computedGross;
    const grossEarnings = fields.grossEarnings ? round2(fields.grossEarnings.value) : computedGross;

    const netEarnings = round2(grossEarnings * (1 - config.deductionRate));

    // ── The ratchet ──
    cumulativeGross = round2(cumulativeGross + grossEarnings);

    const computedPercent = tierPercentFor(cumulativeGross, config);
    computed.commissionPercent = computedPercent;
    const commissionPercent = fields.commissionPercent ? fields.commissionPercent.value : computedPercent;

    const computedCommission = round2(netEarnings * (commissionPercent / 100));
    computed.commission = computedCommission;
    const commission = fields.commission ? round2(fields.commission.value) : computedCommission;

    // ── Hours and accounts, per shift ──
    const shiftInputs = day?.shifts ?? [];
    const assignedCreators = new Set<string>();
    for (const s of shiftInputs) {
      if (!s.paysWage) continue;
      for (const c of s.creatorIds) assignedCreators.add(c);
    }

    // The account count an admin sees and can override. Shift assignments are
    // authoritative; distinct creators with a sale are the fallback for days
    // recorded before assignments existed, and are flagged as inferred.
    const salesCreatorCount = new Set(day?.salesCreatorNames ?? []).size;
    let accountCountSource: AccountCountSource;
    let computedAccountCount: number;
    if (assignedCreators.size > 0) {
      computedAccountCount = assignedCreators.size;
      accountCountSource = 'shift';
    } else if (salesCreatorCount > 0) {
      computedAccountCount = salesCreatorCount;
      accountCountSource = 'sales';
    } else {
      computedAccountCount = 0;
      accountCountSource = 'none';
    }
    computed.accountCount = computedAccountCount;

    const accountCount = fields.accountCount ? Math.max(0, Math.round(fields.accountCount.value)) : computedAccountCount;
    if (fields.accountCount) accountCountSource = 'override';

    const computedTrackedHours = round2h(
      shiftInputs.reduce((sum, s) => sum + (s.paysWage ? s.trackedSeconds : 0), 0) / 3600,
    );

    // Per-shift breakdown. The rate basis decides whether each shift is rated
    // from its own accounts or from the day's total.
    const dayRate = hourlyRateFor(accountCount, config);
    const shifts: SalaryShiftBreakdown[] = shiftInputs.map(s => {
      const payable = s.paysWage ? payableHoursFor(s.trackedSeconds, s.scheduledHours, config) : 0;
      const shiftAccounts = s.paysWage ? new Set(s.creatorIds).size : 0;
      const rate = !s.paysWage
        ? 0
        : config.wageRateBasis === 'per-day'
          ? dayRate
          : hourlyRateFor(shiftAccounts, config);
      return {
        shiftId: s.shiftId,
        occurrenceStart: s.occurrenceStart,
        scheduledHours: s.scheduledHours,
        trackedHours: round2h(s.trackedSeconds / 3600),
        payableHours: payable,
        accountCount: shiftAccounts,
        hourlyRate: rate,
        wage: round2(payable * rate),
        isOvertime: s.isOvertime,
        paysWage: s.paysWage,
        creatorIds: s.creatorIds,
      };
    });

    const computedHours = round2h(shifts.reduce((sum, s) => sum + s.payableHours, 0));
    computed.hours = computedHours;
    const hours = fields.hours ? round2h(Math.max(0, fields.hours.value)) : computedHours;

    // The effective rate. With one paying shift it *is* that shift's rate; with
    // several it is the blend, which is the only honest single number to show.
    const payingShifts = shifts.filter(s => s.paysWage && s.payableHours > 0);
    const computedRate =
      payingShifts.length === 1
        ? payingShifts[0].hourlyRate
        : computedHours > 0
          ? round2(shifts.reduce((sum, s) => sum + s.wage, 0) / computedHours)
          : dayRate;
    computed.hourlyRate = computedRate;
    const hourlyRate = fields.hourlyRate ? fields.hourlyRate.value : computedRate;

    // Wage recomputes from hours × rate whenever either was overridden, so an
    // admin who edits hours does not also have to restate the wage.
    const wageFromShifts = round2(shifts.reduce((sum, s) => sum + s.wage, 0));
    const computedWage =
      fields.hours || fields.hourlyRate || fields.accountCount ? round2(hours * hourlyRate) : wageFromShifts;
    computed.wage = computedWage;
    const wage = fields.wage ? round2(fields.wage.value) : computedWage;

    const computedSalary = round2(commission + wage);
    computed.salary = computedSalary;
    const salary = fields.salary ? round2(fields.salary.value) : computedSalary;

    // ── Assemble ──
    const overrides: SalaryDayResult['overrides'] = {};
    for (const key of Object.keys(fields) as SalaryOverrideField[]) {
      const entry = fields[key];
      if (!entry) continue;
      overrides[key] = { ...entry, computed: computed[key] ?? 0 };
    }

    const saleCount = day?.saleCount ?? 0;

    results.push({
      day: dayKey,
      grossEarnings,
      netEarnings,
      cumulativeGross,
      commissionPercent,
      commission,
      trackedHours: computedTrackedHours,
      hours,
      accountCount,
      accountCountSource,
      hourlyRate,
      wage,
      salary,
      saleCount,
      shifts,
      missingShift: saleCount > 0 && shiftInputs.length === 0,
      overrides,
      note: override?.note ?? null,
    });
  }

  return {
    userId,
    month,
    days: results,
    totals: sumMonth(results),
    tier: computeTierProgress(cumulativeGross, config),
    config,
    status: 'open',
  };
}

/**
 * Month totals, summed from the rounded day figures.
 *
 * `daysWorked` counts days with payable hours or a sale — not days with a
 * non-zero salary, which would miss a worked day that happened to earn nothing.
 */
export function sumMonth(days: SalaryDayResult[]): SalaryMonthTotals {
  const totals: SalaryMonthTotals = {
    grossEarnings: 0,
    netEarnings: 0,
    commission: 0,
    wage: 0,
    salary: 0,
    hours: 0,
    daysWorked: 0,
    saleCount: 0,
  };

  for (const d of days) {
    totals.grossEarnings = round2(totals.grossEarnings + d.grossEarnings);
    totals.netEarnings = round2(totals.netEarnings + d.netEarnings);
    totals.commission = round2(totals.commission + d.commission);
    totals.wage = round2(totals.wage + d.wage);
    totals.salary = round2(totals.salary + d.salary);
    totals.hours = round2(totals.hours + d.hours);
    totals.saleCount += d.saleCount;
    if (d.hours > 0 || d.saleCount > 0) totals.daysWorked += 1;
  }

  return totals;
}
