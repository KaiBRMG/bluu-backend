/**
 * Chat-agent salary — the shapes that cross the wire.
 *
 * These are the *serialised* types: plain numbers and `YYYY-MM-DD` strings, no
 * Firestore `Timestamp`s, so the same declarations type the engine, the API
 * response and the React tree. Firestore document shapes live in
 * `types/firestore.ts`.
 */

import type { SalaryDayKey, SalaryMonthKey } from './salaryDate';
import type { CommissionTier, SaleStatus } from './salaryConstants';

// ─── Rate configuration ──────────────────────────────────────────────

/**
 * How the hourly wage rate is chosen when an agent works more than one shift in
 * a day — a regular shift plus an overtime shift, typically.
 *
 * `per-shift` (the default) rates each shift from the accounts worked *on that
 * shift*: a 3-account regular shift pays $3.50/h and a 2-account overtime shift
 * pays $2.50/h. `per-day` rates every hour of the day from the day's total
 * distinct accounts, which pays materially more for the same work. The reading
 * is genuinely ambiguous in the source spec, so it is a setting rather than a
 * constant — flip it in CA Admin → Rates.
 */
export type WageRateBasis = 'per-shift' | 'per-day';

export interface SalaryConfig {
  /** Platform cut. Net = gross × (1 − deductionRate). */
  deductionRate: number;
  /** Ascending, `minGross` inclusive. */
  commissionTiers: CommissionTier[];
  /** Account count → $/hour. */
  wageTiers: Record<number, number>;
  /** Minutes credited to a worked shift before the cap. */
  graceMinutes: number;
  /** Default ceiling on a shift's payable hours, when the shift's own length is unknown. */
  defaultShiftHours: number;
  wageRateBasis: WageRateBasis;
  /** Audit — who last changed the rates, and when. Absent on the built-in defaults. */
  updatedBy?: string | null;
  updatedAt?: string | null;
}

// ─── Overrides ───────────────────────────────────────────────────────

/**
 * The fields an admin may override on a single day.
 *
 * They are listed in dependency order, and that order is load-bearing: the
 * engine recomputes everything downstream of an override unless the downstream
 * field is itself overridden. Overriding `grossEarnings` therefore moves the
 * month-to-date total and can re-tier every later day — which is correct, and
 * is why the month view marks the days that moved.
 */
export const SALARY_OVERRIDE_FIELDS = [
  'grossEarnings',
  'hours',
  'accountCount',
  'hourlyRate',
  'commissionPercent',
  'commission',
  'wage',
  'salary',
] as const;

export type SalaryOverrideField = (typeof SALARY_OVERRIDE_FIELDS)[number];

export interface SalaryOverrideEntry {
  value: number;
  setBy: string;
  setByName?: string;
  setAt: string;
  reason?: string;
}

export interface SalaryDayOverride {
  day: SalaryDayKey;
  userId: string;
  fields: Partial<Record<SalaryOverrideField, SalaryOverrideEntry>>;
  /** Free text an admin can attach to a day, shown to the agent. */
  note?: string | null;
}

// ─── Engine input ────────────────────────────────────────────────────

/** One shift's contribution to a day, already resolved against the time ledger. */
export interface SalaryShiftInput {
  shiftId: string;
  /** Identifies the occurrence of a recurring series. */
  occurrenceStart: number;
  /** Scheduled length in hours — the ceiling on this shift's payable hours. */
  scheduledHours: number;
  /** Seconds actually worked inside the shift window (idle and pause already excluded). */
  trackedSeconds: number;
  /** Creators assigned to this shift. */
  creatorIds: string[];
  /**
   * The subset of `creatorIds` worked as overtime **inside** this shift.
   *
   * Subtracted from the shift's account count, so the agent keeps the sales but
   * the hourly rate does not move — the same outcome as a `paysWage: false`
   * cover shift, reached on the one shift an admin actually edits. Never
   * populated on an outside-shift overtime shift, whose accounts do pay.
   */
  overtimeCreatorIds: string[];
  /** True for a shift created to cover someone else's released accounts. */
  isOvertime: boolean;
  /**
   * False for accounts picked up *inside* an existing shift's hours: the agent
   * keeps the sales but the wage does not move, so the shift contributes
   * neither payable hours nor accounts to the rate tier.
   */
  paysWage: boolean;
}

export interface SalaryDayInput {
  day: SalaryDayKey;
  /** Signed gross for the day. Reversals are negative and can take this below zero. */
  grossEarnings: number;
  saleCount: number;
  /** Distinct creator names with a sale that day — the account-count fallback. */
  salesCreatorNames: string[];
  shifts: SalaryShiftInput[];
}

export interface SalaryMonthInput {
  userId: string;
  month: SalaryMonthKey;
  days: SalaryDayInput[];
  overrides: SalaryDayOverride[];
  config: SalaryConfig;
}

// ─── Engine output ───────────────────────────────────────────────────

/** Where a day's account count came from, which decides whether to flag it as inferred. */
export type AccountCountSource = 'shift' | 'sales' | 'override' | 'none';

export interface SalaryShiftBreakdown {
  shiftId: string;
  occurrenceStart: number;
  scheduledHours: number;
  trackedHours: number;
  /** After grace, capped at `scheduledHours`. */
  payableHours: number;
  accountCount: number;
  hourlyRate: number;
  wage: number;
  isOvertime: boolean;
  paysWage: boolean;
  creatorIds: string[];
  /** Which of `creatorIds` were unpaid in-shift overtime, so the row can say so. */
  overtimeCreatorIds: string[];
}

export interface SalaryDayResult {
  day: SalaryDayKey;

  grossEarnings: number;
  netEarnings: number;
  /** Month-to-date gross including this day — the number the tier is read from. */
  cumulativeGross: number;
  commissionPercent: number;
  commission: number;

  /** Raw worked hours across the day's shifts, before grace and the cap. */
  trackedHours: number;
  /** Payable hours after grace and the per-shift cap. */
  hours: number;
  accountCount: number;
  accountCountSource: AccountCountSource;
  /** Effective $/hour. With one shift this is that shift's rate; with several, wage ÷ hours. */
  hourlyRate: number;
  wage: number;

  salary: number;

  saleCount: number;
  shifts: SalaryShiftBreakdown[];
  /** True when the day has sales but no shift on record — hours cannot be derived. */
  missingShift: boolean;
  /** Which fields an admin replaced, and what the engine would otherwise have said. */
  overrides: Partial<Record<SalaryOverrideField, SalaryOverrideEntry & { computed: number }>>;
  note?: string | null;
  /**
   * Approved leave taken on this day, by type. **Display only** — the engine
   * does not price leave. Attached on read by `buildSalaryMonth`, never by
   * `computeSalaryMonth`, so it is absent on the roster/overview paths.
   */
  leave?: Array<'paid' | 'unpaid'>;
}

export interface SalaryTierProgress {
  /** The tier the agent is currently earning at. */
  currentPercent: number;
  /** The next tier up, or null once the top tier is reached. */
  nextPercent: number | null;
  /** Gross still needed to reach `nextPercent`, or null at the top tier. */
  grossToNext: number | null;
  /** 0–1 through the current tier band. 1 at the top tier. */
  progress: number;
  /** Gross at which the current tier started — the band's floor. */
  tierFloor: number;
  /** Gross at which the next tier starts, or null at the top. */
  tierCeiling: number | null;
}

export interface SalaryMonthTotals {
  grossEarnings: number;
  netEarnings: number;
  commission: number;
  wage: number;
  salary: number;
  hours: number;
  daysWorked: number;
  saleCount: number;
}

export interface SalaryMonthResult {
  userId: string;
  month: SalaryMonthKey;
  days: SalaryDayResult[];
  totals: SalaryMonthTotals;
  tier: SalaryTierProgress;
  config: SalaryConfig;
  /** Set once an admin finalises the month; the numbers are then frozen. */
  status: 'open' | 'finalized';
  finalizedAt?: string | null;
  finalizedBy?: string | null;
  finalizedByName?: string | null;
}

// ─── Sales ───────────────────────────────────────────────────────────

/** One imported sale row, serialised. */
export interface SalarySale {
  saleId: string;
  userId: string;
  day: SalaryDayKey;
  month: SalaryMonthKey;
  occurredAt: string;
  employeeName: string;
  sourceEmail: string;
  creatorName: string;
  fanName: string;
  fanId: string;
  /** Always positive — the amount as the export states it. */
  grossRevenue: number;
  netRevenue: number;
  /** `grossRevenue`, negated for a reversal. This is what the engine sums. */
  signedGross: number;
  type: string;
  rule: string;
  assignedBy: string;
  status: SaleStatus;
  importId: string;
}

// ─── Import reporting ────────────────────────────────────────────────

export interface SalesImportSkip {
  reason: 'unmapped-email' | 'unparseable-date' | 'unparseable-amount' | 'missing-email';
  detail: string;
  rowCount: number;
  /** Up to a handful of source row numbers, for the admin to look up. */
  sampleRows: number[];
}

export interface SalesImportResult {
  importId: string;
  fileName: string;
  uploadedBy: string;
  uploadedAt: string;
  /** Data rows in the file, excluding the header. */
  totalRows: number;
  /** Rows written as new sales. */
  imported: number;
  /** Rows already present with the same identity — re-uploading a file is safe. */
  duplicates: number;
  /** Rows deliberately not imported, grouped by reason. */
  skipped: SalesImportSkip[];
  skippedRows: number;
  /** Months the import touched, so the UI can point at what changed. */
  monthsTouched: SalaryMonthKey[];
  /** Per-agent gross written, for a reconciliation glance against the source sheet. */
  perUser: Array<{ userId: string; displayName: string; sourceEmail: string; gross: number; rows: number }>;
  /** Months that were already finalised and therefore refused the rows. */
  rejectedFinalizedMonths: SalaryMonthKey[];
}
