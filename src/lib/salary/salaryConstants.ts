/**
 * Chat-agent salary — the constants the whole subsystem agrees on.
 *
 * Every number here was a spreadsheet convention before it was code. They are
 * defaults, not law: `ca-salary-config/current` overrides the rate tables at
 * runtime (see `salaryConfig.ts`), because a rate change must reach a renderer
 * that may be weeks old (CLAUDE.md rule 9c) and must never require a deploy.
 * What is *not* configurable lives here as a plain constant.
 */

/**
 * The canonical salary day boundary, for every agent regardless of where they
 * live.
 *
 * The sales export is stamped `Africa/Harare` and the shift roster is managed
 * in SAST — both UTC+2, neither observes DST. Using one company-wide boundary
 * is what makes a month's totals reconcile exactly against the source
 * spreadsheet, and what stops a sale landing on a different day than the shift
 * that earned it. Agents still *read* times in their own timezone; only the
 * bucketing is fixed.
 */
export const SALARY_TIMEZONE = 'Africa/Harare';

/** Fixed UTC offset of {@link SALARY_TIMEZONE}, in minutes. No DST — CAT is +02:00 year-round. */
export const SALARY_TZ_OFFSET_MINUTES = 120;

/** The platform's cut. Net = gross × (1 − this). Matches `Net revenue` in the export exactly. */
export const DEFAULT_DEDUCTION_RATE = 0.2;

/** A full shift, in hours. The ceiling on a single shift's payable `hours`. */
export const DEFAULT_SHIFT_HOURS = 8;

/** Minutes credited to every worked day before the {@link DEFAULT_SHIFT_HOURS} cap applies. */
export const DEFAULT_GRACE_MINUTES = 15;

/**
 * Hours a day of approved **paid** leave pays, at the rate for the accounts the
 * agent held on their last worked day. The shift itself is gone — approval
 * tombstones it and releases its accounts — so nothing tracked exists to pay.
 */
export const PAID_LEAVE_HOURS = 8;

/**
 * How far back a paid-leave day looks for "the previous day's accounts". The
 * day before is usually a day off or more leave, so it walks back to the most
 * recent day with an assignment — but not indefinitely: past this, the day
 * pays on no accounts and an admin sets the count.
 */
export const PAID_LEAVE_ACCOUNT_LOOKBACK_DAYS = 7;

/**
 * Commission tiers, on a sliding scale keyed to **month-to-date gross**.
 *
 * The scale ratchets: the day a threshold is crossed takes the new rate, and so
 * does every day after it in that month. Days before it keep the rate they were
 * earned at and are never restated. `minGross` is inclusive, tiers ascend.
 */
export interface CommissionTier {
  /** Month-to-date gross, inclusive, at which this tier starts. */
  minGross: number;
  /** Percentage applied to the day's net. `2.5` means 2.5%, not 0.025. */
  percent: number;
}

export const DEFAULT_COMMISSION_TIERS: CommissionTier[] = [
  { minGross: 0, percent: 2.5 },
  { minGross: 4000, percent: 3.0 },
  { minGross: 8000, percent: 4.0 },
  { minGross: 12000, percent: 5.0 },
];

/**
 * Hourly wage by the number of creator accounts worked that day.
 *
 * Keyed by account count. 2/3/4 are the rates as operated; 1 and 5 continue the
 * +$1.00 step and were confirmed by extrapolation rather than observed, so they
 * are the first thing to correct if payroll disputes a figure. A count above
 * the highest key clamps to the highest rate; a count of 0 pays no wage at all
 * (no accounts worked is not a shift).
 */
export const DEFAULT_WAGE_TIERS: Record<number, number> = {
  1: 1.5,
  2: 2.5,
  3: 3.5,
  4: 4.5,
  5: 5.5,
};

/**
 * A sale's disposition in the source system.
 *
 * `reverse` is a refund or chargeback. It is stored as a **negative** signed
 * amount on its own date, so it reduces that day's gross, that day's commission
 * and the month-to-date threshold — the agent does not keep commission on money
 * the fan got back. A day can legitimately go negative as a result.
 */
export type SaleStatus = 'complete' | 'reverse';

// ─── The salary history floor ────────────────────────────────────────

/**
 * The first month any salary view shows. Earlier months exist in `ca-sales`
 * (the Infloww history import reaches back to October 2025) but were paid
 * outside Bluu Backend, so a computed "salary" for them would be a figure
 * nobody was paid. They feed analytics only.
 *
 * Enforced server-side on every `/api/ca-salary/*` route (`refuseHiddenMonth`)
 * and mirrored by the month pickers, which stop here. Plain data, safe for the
 * client to import.
 */
export const SALARY_HISTORY_START_MONTH = '2026-09';

/** Whether a salary view may show this month. */
export function isSalaryMonthVisible(month: string): boolean {
  return month >= SALARY_HISTORY_START_MONTH;
}

// ─── The Infloww → BuddyX cutover ────────────────────────────────────

/**
 * The instant of the last Infloww sale: `2026-10-04 08:50:31` in the salary
 * timezone (`06:50:31Z`).
 *
 * **Each source owns its own side of this instant, and nothing counts twice.**
 * Infloww owns every sale at or before it — the historical import refuses
 * anything later — and BuddyX owns every sale after it — the sync drops
 * anything earlier. Before it, BuddyX's own attribution is unusable for pay:
 * most tips from 27 Sep to 3 Oct are unassigned, because chatters had not yet
 * moved into the BuddyX app (verified against the live API, 2026-10-06).
 */
export const SALES_CUTOVER_AT = Date.UTC(2026, 9, 4, 6, 50, 31);

/** Which system owns a sale at this instant. */
export type SalesSource = 'infloww' | 'buddyx';

/**
 * The one predicate both writers use, so the two sides of the cutover cannot
 * drift apart: the sync keeps a row only when this says `buddyx`, the
 * historical import only when it says `infloww`.
 */
export function salesSourceFor(occurredAtMs: number): SalesSource {
  return occurredAtMs <= SALES_CUTOVER_AT ? 'infloww' : 'buddyx';
}

/** What kind of sale a row is. In BuddyX a PPV belongs to its sender; the sync credits both kinds to the agent on shift (`scheduleHolder`). */
export type SaleKind = 'tip' | 'ppv';
