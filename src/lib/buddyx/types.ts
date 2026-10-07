/**
 * BuddyX Public API — wire types, as `buddyxapi.yaml` declares them, plus the
 * one normalisation the live API needs.
 *
 * These describe what arrives over HTTP and nothing else. What we *store* lives
 * in `types/firestore.ts`; the sync service is the only thing that translates
 * one into the other.
 */

/**
 * Ids arrive as JSON **numbers** (`chatterId`, `fanId`), although the spec
 * allows `string | integer`. Verified against the live API on 2026-10-06.
 * Everything we store keys on a string, so every id is normalised here, at the
 * boundary — a number that slipped through would never match the same id
 * stored as a string, and the row would silently map to nobody.
 */
export function normaliseId(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text === '' ? null : text;
}

export interface BuddyxPagination {
  hasMore: boolean;
  nextCursor: string | null;
  total?: number | null;
}

export interface BuddyxPage<T> {
  data: T[];
  pagination?: BuddyxPagination;
  requestId?: string | null;
}

export interface RevenueAmount {
  gross: number;
  net: number;
}

export interface BuddyxCreator {
  id: string;
  handle: string | null;
  customName: string | null;
  revShare: number | null;
}

export interface BuddyxTeamMember {
  id: string | number;
  name: string | null;
  email: string | null;
  status: string | null;
  timeZone: string | null;
}

export interface BuddyxTipRow {
  id: string;
  modelId: string | number | null;
  modelHandle: string | null;
  chatterId: string | number | null;
  chatterName: string | null;
  fanId: string | number | null;
  type: string | null;
  amount: RevenueAmount;
  datePurchase: string | null;
}

/** PPV rows carry no `type` field — they are always a PPV. */
export interface BuddyxPpvRow {
  id: string;
  modelId: string | number | null;
  modelHandle: string | null;
  fanId: string | number | null;
  chatterId: string | number | null;
  chatterName: string | null;
  revenue: RevenueAmount;
  unlockDate: string | null;
  createdAt: string | null;
}

export interface BuddyxOverviewTotals {
  revenue: RevenueAmount;
  tips: RevenueAmount;
  tipsAssigned: RevenueAmount;
  tipsCount: number;
  ppvsSent: number;
  ppvsUnlocked: number;
  unlockRate: number;
  ppvRate: number;
  fansChatted: number;
  totalMessages: number;
  onlineMs: number;
  medianResponseTimeMs: number | null;
  p75ResponseTimeMs: number | null;
}

export interface BuddyxOverviewRow {
  chatterId: string | number;
  chatterName: string | null;
  revenue: RevenueAmount;
  ppvsUnlocked: number;
  ppvsSent: number;
  ppvRate: number;
  unlockRate: number;
  fansChatted: number;
  totalMessages: number;
  tips: RevenueAmount;
  tipsCount: number;
  onlineMs: number;
  medianResponseTimeMs: number | null;
  p75ResponseTimeMs: number | null;
}

export interface BuddyxOverview {
  totals: BuddyxOverviewTotals;
  breakdown: BuddyxOverviewRow[];
}

export interface BuddyxEarningsRow {
  modelId: string;
  handle: string | null;
  customName: string | null;
  revenue: RevenueAmount;
  tips: RevenueAmount;
  messages: RevenueAmount;
  subscriptions: RevenueAmount;
  newSubs: number;
  massMessages: number;
  revShare: number | null;
  revShareAmount: RevenueAmount | null;
}

export interface BuddyxSubscriber {
  id: string;
  modelId: string | null;
  fanId: string | number | null;
  type: string | null;
  subType: string | null;
  isCreator: boolean;
  isTrial: boolean;
  price: RevenueAmount;
  subscribedAt: string | null;
}

export interface BuddyxMassMessage {
  id: string;
  messageId: string | null;
  modelId: string | null;
  sentBy: string | number | null;
  sentDate: string | null;
  price: number;
  previews: string[];
  unsentBy: string | number | null;
  unsentDate: string | null;
}

export interface BuddyxTrackingLink {
  id: string;
  linkId: string;
  modelId: string;
  campaignName: string | null;
  campaignCode: string | null;
  url: string | null;
  createdAt: string | null;
  archived: boolean;
  cost: number;
  countSubscribers: number;
  countTransitions: number;
  metrics: { revenue: number; fansCount: number };
}

export interface BuddyxFreeTrialLink {
  id: string;
  linkId: string;
  modelId: string;
  name: string | null;
  url: string | null;
  createdAt: string | null;
  archived: boolean;
  cost: number;
  claimCounts: number;
  subscribeCounts: number;
  metrics: { revenue: number; fansCount: number; revenueFromStackers: number; stackersCount: number };
}

export interface BuddyxLinkFan {
  id: string;
  fanId: string | number | null;
  fanName: string | null;
  isStacker?: boolean;
  currentSubDate: string | null;
  totalSpentBeforeIndex: number;
  totalSpentAfterIndex: number;
  totalSpent: number;
}
