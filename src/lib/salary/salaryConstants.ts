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
 * Source-export email → the agent's Bluu Backend login address.
 *
 * The third-party sales tool still identifies agents by their old
 * `@bluurock.com` address; this app authorises on the personal Google account
 * they migrated to. The importer resolves in this order, and stops at the first
 * hit: this table → `users.workEmail`, then the raw source address →
 * `users.workEmail` (which covers anyone not yet migrated).
 *
 * An address that resolves to nothing is **reported, never guessed** — the
 * import result names it and the row count behind it. `jessy@bluurock.com`
 * appears in historical exports and is deliberately absent: that agent has left
 * and her rows are skipped.
 *
 * TEMPORARY in spirit — this whole mapping disappears when sales come from OF
 * Manager, which already knows the uid. See documentation/ca-salary.md.
 */
export const SALES_EMAIL_MAP: Record<string, string> = {
  'jenelle@bluurock.com': 'jenelle.monterde77@gmail.com',
  'michael@bluurock.com': 'demilademichael13@gmail.com',
  'angela@bluurock.com': 'angelasilla0399@gmail.com',
  'olu@bluurock.com': 'describes101@gmail.com',
  'queen@bluurock.com': 'agboolaq20@gmail.com',
  'ayo@bluurock.com': 'ayomideolujimi37@gmail.com',
  'mannie@bluurock.com': 'adebariadeniran@gmail.com',
  'dami@bluurock.com': 'ajisedamilolaferanmi@gmail.com',
};

/** The columns the importer requires. A file missing any of these is rejected whole. */
export const REQUIRED_SALES_COLUMNS = [
  'Date & time Africa/Harare',
  'Employee',
  'Email',
  'Creator',
  'Fan',
  'Fan ID',
  'Earnings',
  'Gross revenue',
  'Net revenue',
  'Type',
] as const;

/** Columns the export also carries and we keep, but do not require. */
export const OPTIONAL_SALES_COLUMNS = ['Rule', 'Assigned by', 'Status'] as const;

/**
 * A sale's disposition in the source system.
 *
 * `reverse` is a refund or chargeback. It is stored as a **negative** signed
 * amount on its own date, so it reduces that day's gross, that day's commission
 * and the month-to-date threshold — the agent does not keep commission on money
 * the fan got back. A day can legitimately go negative as a result.
 */
export type SaleStatus = 'complete' | 'reverse';
