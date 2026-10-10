/**
 * The wire shapes of the three BuddyX analytics routes. Plain data, imported by
 * both the server read models (`buddyxAnalyticsService.ts`) and the pages.
 */
import type { CoverageFigures } from './coverage';
import type { InputPermission, InputSource } from '../inputQuality';

export type { CoverageFigures };

// ─── Chatter Analytics ───────────────────────────────────────────────

export const CHATTER_PERIODS = ['mtd', 'prev-month', '7d', '30d', 'custom'] as const;
export type ChatterPeriod = (typeof CHATTER_PERIODS)[number];

/** A custom range sums days; past this it stops being a page and becomes a report. */
export const MAX_CUSTOM_DAYS = 92;

/**
 * One chatter's figures for a period. Money is gross.
 *
 * Revenue comes from the sales ledger (Infloww history, then BuddyX) and is
 * always present. Activity comes from BuddyX team reports only, so it is
 * `null` for any part of a period before BuddyX started (`activityFrom`).
 */
export interface ChatterMetrics {
  ppvGross: number;
  tipsGross: number;
  tipsCount: number;
  /** PPVs sold, from the ledger. */
  ppvSales: number;
  ppvsSent: number | null;
  ppvsUnlocked: number | null;
  unlockRate: number | null;
  ppvRate: number | null;
  fansChatted: number | null;
  totalMessages: number | null;
  onlineMs: number | null;
  /** `null` for a custom range that has not been pulled — medians cannot be summed from days. */
  medianResponseTimeMs: number | null;
  p75ResponseTimeMs: number | null;
  /** BuddyX revenue ÷ BuddyX online hours. `null` with no online time. */
  revenuePerOnlineHour: number | null;
}

export type BenchmarkKey =
  | 'ppvGross'
  | 'tipsGross'
  | 'unlockRate'
  | 'fansChatted'
  | 'totalMessages'
  | 'onlineMs'
  | 'medianResponseTimeMs'
  | 'revenuePerOnlineHour';

/** Where one agent sits against the team on one metric — no colleague named. */
export interface Benchmark {
  key: BenchmarkKey;
  value: number | null;
  median: number | null;
  /** The top-quartile mark: p75 when higher is better, p25 when lower is (reply time). */
  topQuartile: number | null;
  lowerIsBetter: boolean;
  /** How many of the *other* agents this agent beats. */
  beats: number;
  /** Other agents compared against. */
  of: number;
}

export interface MassMessageSummary {
  count: number;
  avgPrice: number | null;
  unsent: number;
}

export interface ChatterDailyPoint {
  day: string;
  ppvGross: number;
  tipsGross: number;
}

// ─── Integrity (admin only) ──────────────────────────────────────────
//
// Coverage (BuddyX online while clocked in) plus the input-quality and
// unchanged-screen signals. **Display only** — nothing here changes worked
// time or pay — and never sent to an agent (documentation/time-tracking.md §4b).

/** One agent's input-quality and screen counters over a period, summed from `integrity-days`. */
export interface IntegritySummary {
  monitoredMinutes: number;
  keys: number;
  regularMinutes: number;
  modifierOnlyMinutes: number;
  staticMinutes: number;
  captures: number;
  comparedCaptures: number;
  unchangedCaptures: number;
  /** The most recent collector and permission in the period. */
  inputSource: InputSource | null;
  permission: InputPermission | null;
}

export type IntegrityFlagKind =
  | 'never-online'
  | 'low-coverage'
  | 'regular-input'
  | 'modifier-only'
  | 'static-screen'
  | 'input-permission';

/** One line on the flags list — a lead to look at, never a finding. */
export interface IntegrityFlag {
  uid: string;
  name: string;
  kind: IntegrityFlagKind;
  severity: 'high' | 'medium';
  /** Flagged minutes (input / static kinds). */
  minutes: number | null;
  /** Coverage ratio (low-coverage). */
  ratio: number | null;
  /** Shifts involved (never-online, low-coverage). */
  shifts: number | null;
  /** Salary days the signal appeared on, ascending. */
  days: string[];
}

export interface ChatterLeaderboardRow extends ChatterMetrics {
  uid: string | null;
  chatterId: string;
  name: string;
  /** Bluu clocked-in time over the period, from the time ledger. */
  clockedMs: number | null;
  /** BuddyX online vs clocked working time. Null for an unlinked chatter or a period before BuddyX. */
  coverage: CoverageFigures | null;
  /** The same, day by day — each agent's small chart. Empty for an unlinked chatter. */
  days: ReportDay[];
  /** Null when the agent had no monitored capture in the period. */
  integrity: IntegritySummary | null;
  /** Distinct accounts rostered across the agent's shifts in the period. */
  accounts: number;
  /** (PPV + tips) ÷ accounts. */
  revenuePerAccount: number | null;
  mass: MassMessageSummary;
}

export interface ChatterAnalytics {
  period: ChatterPeriod;
  from: string;
  to: string;
  /** First day BuddyX activity exists; before it, only revenue does. */
  activityFrom: string;
  /** False for a custom range nobody has pulled — the medians are absent. */
  hasMedians: boolean;
  /** The viewer's own figures (null when they have no BuddyX chatter mapped). */
  me: ChatterMetrics | null;
  daily: ChatterDailyPoint[];
  mass: MassMessageSummary;
  /** Null when fewer than 3 agents were active — comparing would identify a colleague. */
  benchmarks: Benchmark[] | null;
  /** `ca-admin` only. */
  leaderboard: ChatterLeaderboardRow[] | null;
  /** The viewer's own coverage. Agents see this; they never see flags. */
  coverage: CoverageFigures | null;
  /** `ca-admin` only: the ranked flag list. */
  flags: IntegrityFlag[] | null;
  /** First day in the period with hourly BuddyX data; days before it are judged on day totals. */
  hourlyFrom: string | null;
}

// ─── Per-chatter report (admin only) ─────────────────────────────────

export interface ReportShift {
  /** Scheduled window; for an unscheduled session, the session's own span. */
  startMs: number;
  endMs: number;
  scheduled: boolean;
  isOvertime: boolean;
  accounts: number;
  clockedMs: number;
  onlineWhileClockedMs: number | null;
  ratio: number | null;
  /** BuddyX messages in the hours the shift touches (whole hours, so approximate). */
  messages: number | null;
  regularMinutes: number;
  modifierOnlyMinutes: number;
  staticMinutes: number;
  /** Whether any capture in the shift carried an input summary. */
  monitored: boolean;
}

export interface ReportDay {
  day: string;
  clockedMs: number;
  onlineWhileClockedMs: number;
}

export interface ChatterReport {
  uid: string;
  name: string;
  metrics: ChatterMetrics | null;
  coverage: CoverageFigures | null;
  integrity: IntegritySummary | null;
  flags: IntegrityFlag[];
  shifts: ReportShift[];
  daily: ReportDay[];
  /** Input monitoring is on for this agent right now. */
  inputMonitoring: boolean;
}

export type SegmentStateCode = 'working' | 'idle' | 'on-break' | 'paused';

/** One shift at minute grain, for the report's timeline. */
export interface ShiftDetail {
  /** The drawn window (the shift, widened to cover any session that spills past it). */
  fromMs: number;
  toMs: number;
  scheduled: { startMs: number; endMs: number } | null;
  segments: Array<{ startMs: number; endMs: number; state: SegmentStateCode }>;
  /** `onlineMs` null = no hourly data for that hour. */
  hours: Array<{ startMs: number; onlineMs: number | null; messages: number | null }>;
  /** Keys per minute from `fromMs`; -1 = no data for that minute. */
  keysPerMinute: number[];
  intervals: Array<{ startMs: number; endMs: number; kind: 'regular' | 'modifier-only' | 'static' }>;
  captures: Array<{
    atMs: number;
    activityPercent: number | null;
    unchanged: boolean | null;
    /** Signed thumbnail URLs; `null` for a viewer who may not see screenshots (shift-management). */
    thumbnails: string[] | null;
  }>;
  inputSource: InputSource | null;
  permission: InputPermission | null;
}

// ─── Fan Analytics ───────────────────────────────────────────────────

export const FAN_PERIODS = ['month', 'prev-month', '3m', 'lifetime'] as const;
export type FanPeriod = (typeof FAN_PERIODS)[number];

export interface FanSummary {
  creatorId: string;
  fanId: string;
  /** `null` → render the mono id, never "Unknown". */
  name: string | null;
  periodSpend: number;
  periodTips: number;
  periodPpv: number;
  lifetimeSpend: number;
  lifetimeTips: number;
  lifetimePpv: number;
  lastPurchaseAt: number | null;
  firstSeenAt: number | null;
  /** What the fan usually buys. */
  usual: 'tips' | 'ppv' | 'mixed' | null;
}

export interface SpendBucket {
  label: string;
  min: number;
  max: number | null;
  fans: number;
  revenue: number;
}

export interface AcquisitionRow {
  creatorId: string | null;
  linkId: string;
  kind: 'tracking' | 'free-trial';
  name: string | null;
  fans: number;
  revenue: number;
  revenuePerFan: number | null;
  cost: number;
  /** `(revenue − cost) ÷ cost`, or `null` when the link cost nothing — never ∞. */
  roi: number | null;
}

export interface FanAnalytics {
  period: FanPeriod;
  creatorIds: string[];
  /** The creators the viewer may see — the picker's options. */
  scope: string[];
  kpis: {
    spenders: number;
    revenue: number;
    revenuePerSpender: number | null;
    /** Share of revenue from the top 10% of spenders (0–1). */
    whaleShare: number | null;
    /** Trial-acquired fans who have spent ÷ trial-acquired fans (0–1). */
    trialConversion: number | null;
    trialFans: number;
  };
  atRisk: FanSummary[];
  topSpenders: FanSummary[];
  distribution: SpendBucket[];
  subscribers: { new: number; returning: number; trial: number };
  /** `ca-admin` only. */
  acquisition: AcquisitionRow[] | null;
  /** The at-risk rule, stated on the section. */
  atRiskRule: { quietDays: number; windowDays: number };
}

export interface FanPurchase {
  saleId: string;
  occurredAt: string;
  kind: 'tip' | 'ppv';
  type: string;
  gross: number;
  source: 'infloww' | 'buddyx';
  /** Admin: the agent's name. Agent: "You" or "Team". Null when nobody holds it. */
  earnedBy: string | null;
}

export interface FanDetail {
  fan: FanSummary;
  isStacker: boolean;
  acquisition: { kind: 'tracking' | 'free-trial'; linkId: string; linkName: string | null } | null;
  linkTotalSpent: number | null;
  purchases: FanPurchase[];
  subscriptions: Array<{ id: string; at: string | null; subType: string | null; isTrial: boolean; priceGross: number }>;
  earnedBy: Array<{ label: string; gross: number; count: number }>;
}

// ─── OnlyFans Analytics ──────────────────────────────────────────────

export interface CreatorDayPoint {
  day: string;
  source: 'infloww' | 'buddyx';
  totalGross: number | null;
  subsGross: number | null;
  tipsGross: number | null;
  messagesGross: number | null;
  newSubs: number | null;
  fansChatted: number | null;
  messagesSent: number | null;
  ppvsSent: number | null;
  ppvsUnlocked: number | null;
  replyTimeMs: number | null;
  massMessages: number | null;
}

export interface CreatorRosterCard {
  creatorId: string;
  totalGross: number;
  previousGross: number | null;
  subsGross: number;
  tipsGross: number;
  messagesGross: number;
  /** Daily earnings for the sparkline — a rate, not cumulative. Absent days are gaps. */
  spark: Array<{ day: string; value: number | null }>;
}

export interface LinkRow {
  creatorId: string | null;
  linkId: string;
  kind: 'tracking' | 'free-trial';
  name: string | null;
  url: string | null;
  archived: boolean;
  transitions: number | null;
  subscribers: number;
  /** subs ÷ transitions, tracking links only. */
  conversion: number | null;
  revenue: number;
  fans: number;
  revenuePerFan: number | null;
  cost: number;
  roi: number | null;
  stackers: number | null;
  spark: Array<{ day: string; value: number }>;
}

export interface CreatorAnalytics {
  from: string;
  to: string;
  creatorId: string | null;
  /** The first day BuddyX owns — the chart's "Infloww → BuddyX" hairline. */
  cutoverDay: string;
  kpis: {
    earningsMtd: number;
    newSubsMtd: number;
    bestLink: { name: string | null; creatorId: string | null; revenuePerFan: number } | null;
    activeCreators: number;
  };
  roster: CreatorRosterCard[];
  daily: Array<CreatorDayPoint & { creatorCount: number }>;
  subscribers: Array<{ day: string; new: number; returning: number; trial: number }>;
  /** First day `buddyx-subscribers` has data — before it, only `newSubs` totals exist. */
  subscribersFrom: string;
  links: LinkRow[];
  mass: { count: number; avgPrice: number | null; unsentRate: number | null };
  messaging: {
    fansChatted: number;
    ppvsSent: number;
    ppvsUnlocked: number;
    replyTimeMs: number | null;
  };
  /** Omitted (null) while no creator has a rev share configured. */
  revShareGross: number | null;
  comparison: Array<{ creatorId: string; gross: number; share: number; previousGross: number | null }>;
}
