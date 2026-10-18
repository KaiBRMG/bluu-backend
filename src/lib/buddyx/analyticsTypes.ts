/**
 * The wire shapes of the three BuddyX analytics routes. Plain data, imported by
 * both the server read models (`buddyxAnalyticsService.ts`) and the pages.
 */
import type { InputPermission, InputSource } from '../inputQuality';
import type { FanNameSource } from '../fans/fanIdentity';

// ─── Chatter Analytics ───────────────────────────────────────────────

/**
 * `mtd` is the current month, `prev-month` and `month-2` the two before it,
 * `3m` / `6m` / `12m` rolling windows through today. `30d` is no longer offered
 * but is still accepted, for renderers loaded before it was removed (rule 9c).
 */
export const CHATTER_PERIODS = ['7d', 'mtd', 'prev-month', 'month-2', '3m', '6m', '12m', '30d', 'custom'] as const;
export type ChatterPeriod = (typeof CHATTER_PERIODS)[number];

/** A custom range sums days; past a year it stops being a page and becomes a report. */
export const MAX_CUSTOM_DAYS = 366;

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
// "Never online" plus the input-quality and unchanged-screen signals. **Display only** — nothing here changes worked
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
  /** Shifts involved (never-online). */
  shifts: number | null;
  /** Salary days the signal appeared on, ascending. */
  days: string[];
}

/**
 * One agent on the sales board — the page's primary figure is `ppvGross +
 * tipsGross`, and the board is ranked by it. **Sales only, on purpose**: this
 * row goes to every agent (the board is named), so it must never carry
 * activity, integrity or anything else an agent may not see of a colleague.
 */
export interface SalesBoardRow {
  /** Null for a BuddyX chatter linked to nobody — admin only. */
  uid: string | null;
  name: string;
  photoURL: string | null;
  ppvGross: number;
  tipsGross: number;
  ppvSales: number;
  tipsCount: number;
  /**
   * Bluu clocked time over the period. Null when not computed — a range past
   * `BOARD_RATE_MAX_DAYS`, or an unlinked chatter.
   */
  clockedMs: number | null;
  /** Gross ÷ clocked hours; null under an hour clocked or when `clockedMs` is. */
  grossPerHour: number | null;
  /** Distinct accounts rostered across the agent's shifts in the period. */
  accounts: number;
  /** The same agent's gross over the comparison period; null when there is none. */
  prevGross: number | null;
}

/** The whole team's money for a period, against the period before it. */
export interface TeamSales {
  ppvGross: number;
  tipsGross: number;
  /** Null for a range past `BOARD_RATE_MAX_DAYS` — no comparison is read. */
  prev: { from: string; to: string; gross: number } | null;
  daily: ChatterDailyPoint[];
}

/** Past this many days the board skips per-hour rates and the comparison (both cost a read that grows with the range). */
export const BOARD_RATE_MAX_DAYS = 93;

export interface ChatterAnalytics {
  period: ChatterPeriod;
  from: string;
  to: string;
  /** First day BuddyX activity exists; before it, only revenue does. */
  activityFrom: string;
  /** False for a custom range nobody has pulled — the medians are absent. */
  hasMedians: boolean;
  isAdmin: boolean;
  /** The viewer's own figures (null when they have no sales or BuddyX activity). */
  me: ChatterMetrics | null;
  daily: ChatterDailyPoint[];
  mass: MassMessageSummary;
  /** Everyone, named, ranked by gross. Archived agents are left out. */
  board: SalesBoardRow[];
  team: TeamSales;
  /** `ca-admin` only: the ranked flag list. */
  flags: IntegrityFlag[] | null;
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
  /** Gross of the agent's sales made inside the shift's window. */
  gross: number;
  salesCount: number;
  /** BuddyX messages in the hours the shift touches (whole hours, so approximate). */
  messages: number | null;
  regularMinutes: number;
  modifierOnlyMinutes: number;
  staticMinutes: number;
  /** Whether any capture in the shift carried an input summary. */
  monitored: boolean;
}

/** One account's share of an agent's sales. */
export interface ReportAccount {
  /** Creator id when the sale carried one, else the creator name it was imported with. */
  key: string;
  name: string;
  gross: number;
  sales: number;
}

export interface ChatterReport {
  uid: string;
  name: string;
  period: ChatterPeriod;
  /** The days the period resolved to (salary timezone). */
  from: string;
  to: string;
  metrics: ChatterMetrics | null;
  /** Bluu clocked time over the period. */
  clockedMs: number;
  /** Where the agent's own place on the board is (1-based), and of how many. */
  rank: { position: number; of: number } | null;
  integrity: IntegritySummary | null;
  flags: IntegrityFlag[];
  shifts: ReportShift[];
  /** Every day in the period, sales by kind. */
  daily: ChatterDailyPoint[];
  /** Gross by account, largest first. */
  accounts: ReportAccount[];
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
  /** Where the name came from (`fanIdentity.resolveFanName`). */
  nameSource: FanNameSource | null;
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
  creatorId: string | null;
  kind: 'tip' | 'ppv';
  type: string;
  gross: number;
  source: 'infloww' | 'buddyx';
  /** Admin: the agent's name. Agent: "You" or "Team". Null when nobody holds it. */
  earnedBy: string | null;
}

// ─── Fan base (directory + per-fan report) ───────────────────────────

export const FAN_DIRECTORY_FILTERS = ['all', 'customs', 'owes', 'unnamed', 'unmatched'] as const;
export type FanDirectoryFilter = (typeof FAN_DIRECTORY_FILTERS)[number];
export const FAN_DIRECTORY_SORTS = ['spend', 'recent', 'customs', 'name'] as const;
export type FanDirectorySort = (typeof FAN_DIRECTORY_SORTS)[number];

/** One fan in the directory — every creator they buy from folded together. */
export interface FanDirectoryRow {
  fanKey: string;
  fanId: string | null;
  handle: string | null;
  name: string | null;
  nameSource: FanNameSource | null;
  creatorIds: string[];
  lifetimeSpend: number;
  lastPurchaseAt: number | null;
  customs: number;
  outstandingAmount: number;
  /** Known only by an OnlyFans handle: customs, but no id to join sales on. */
  unmatched: boolean;
}

export interface FanDirectory {
  rows: FanDirectoryRow[];
  total: number;
  /** Counts behind each filter, for the filter chips. */
  counts: Record<FanDirectoryFilter, number>;
}

/** A wizard search hit — just enough to recognise the right fan. */
export interface FanLookupHit {
  fanKey: string;
  fanId: string | null;
  handle: string | null;
  name: string | null;
  nameSource: FanNameSource | null;
  profileLink: string;
  /** Gross lifetime spend with the creator the wizard is for (0 when unknown). */
  spendWithCreator: number;
  customs: number;
}

export interface FanCustomItem {
  id: string;
  CR: string | null;
  type: string;
  status: string;
  isCampaign: boolean;
  isArchived: boolean;
  creatorId: string;
  /** The name on this custom, which may differ from the fan's. */
  fanName: string;
  description: string;
  createdTime: string | null;
  totalAmount: number;
  amountPaid: number;
  /** What the fan actually paid — `amountPaid` is rewritten when a campaign is archived. */
  collected: number;
  outstanding: number;
  abandoned: boolean;
  abandonedAmount: number | null;
}

export interface FanReport {
  fanKey: string;
  fanId: string | null;
  handle: string | null;
  /** Handles that were linked into this id. */
  handles: string[];
  profileLink: string;
  name: string | null;
  nameSource: FanNameSource | null;
  /** Who set the manual name, and when. */
  manual: { by: string | null; at: string | null } | null;
  /** What the name would be without the manual one — "Revert to automatic". */
  automatic: { name: string | null; source: FanNameSource | null };
  /** The customs vote behind a customs name: "4 of 6 customs". */
  customsVote: { votes: number; total: number } | null;
  canLink: boolean;
  spend: {
    lifetime: number;
    tips: number;
    ppv: number;
    lastPurchaseAt: number | null;
    firstSeenAt: number | null;
    usual: 'tips' | 'ppv' | 'mixed' | null;
    byCreator: Array<{ creatorId: string; lifetime: number; tips: number; ppv: number; lastPurchaseAt: number | null }>;
    /** `YYYY-MM`, oldest first, every creator summed. */
    monthly: Array<{ month: string; tips: number; ppv: number }>;
  };
  isStacker: boolean;
  acquisition: Array<{ creatorId: string; kind: 'tracking' | 'free-trial'; linkId: string; linkName: string | null }>;
  purchases: FanPurchase[];
  earnedBy: Array<{ label: string; gross: number; count: number }>;
  subscriptions: Array<{ id: string; creatorId: string | null; at: string | null; subType: string | null; isTrial: boolean; priceGross: number }>;
  customs: {
    total: number;
    /** Money actually received across every order, any status. */
    collected: number;
    byType: Array<{ type: string; count: number }>;
    outstanding: { count: number; amount: number };
    abandoned: { count: number; amount: number; unknownAmount: number };
    rejected: number;
    completed: number;
    items: FanCustomItem[];
  };
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

/**
 * Who an account key on OnlyFans Analytics is. Resolved server-side because the
 * client's creator store holds active creators only, and history must still name
 * an archived one.
 */
export interface CreatorIdentity {
  name: string;
  /**
   * `archived` — a Bluu creator (or sub-account) since archived.
   * `missing` — mapped to a creator id that no longer exists in Bluu.
   * `unmapped` — a BuddyX creator mapped to nobody in Bluu.
   */
  status: 'active' | 'archived' | 'missing' | 'unmapped';
  /** Inline 64px avatar for non-active accounts; the client store has the active ones. */
  photoThumb: string | null;
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
  /** Every creator, over the selected period — never scoped by `creatorId`. */
  kpis: {
    earnings: number;
    /** The same-length window before `from`; null when it predates the history. */
    previousEarnings: number | null;
    newSubs: number;
    previousNewSubs: number | null;
    /** The link with the most revenue added inside the period (as BuddyX reports it). */
    topLink: { name: string | null; creatorId: string | null; revenue: number; subs: number } | null;
    earningCreators: number;
    topCreator: { creatorId: string; gross: number; share: number } | null;
    /** @deprecated Legacy keys for stale renderers (rule 9c) — period figures now. */
    earningsMtd: number;
    newSubsMtd: number;
    bestLink: null;
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
  /** Every account key the response mentions (roster, links, best link). */
  identities: Record<string, CreatorIdentity>;
}
