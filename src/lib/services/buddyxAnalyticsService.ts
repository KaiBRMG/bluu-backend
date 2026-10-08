/**
 * The three BuddyX analytics read models — Chatter, Fan and OnlyFans Analytics.
 *
 * **Firestore only.** Nothing here calls the BuddyX API; the sync wrote what
 * these read, and a page view never costs an API request. Each model is cached
 * in module scope for 60s per scope key (the routes add `private, max-age=60`),
 * so a page revisited inside a minute costs nothing at all.
 *
 * Scope is enforced here, not in the client:
 * - Chatter Analytics — an agent gets their own row plus an anonymous benchmark;
 *   `ca-admin` gets the named leaderboard (D8).
 * - Fan Analytics — an agent gets the creators they are rostered on this month;
 *   `ca-admin` gets all (D9). The fan detail refuses a fan outside that scope.
 * - OnlyFans Analytics — everyone with the page sees every creator (internal).
 */
import 'server-only';
import { Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '../firebase-admin';
import {
  addDays,
  addMonths,
  currentDayKey,
  currentMonthKey,
  dayKeyRange,
  monthKeyRange,
  toDayKey,
  type SalaryDayKey,
} from '../salary/salaryDate';
import { round2 } from '../salary/salaryEngine';
import { saleKindOf, saleSourceOf } from '../salary/saleTypes';
import { mappedCreatorIds } from './buddyxMappingService';
import { computeBenchmarks } from '../buddyx/benchmarks';
import { BUDDYX_CREATOR_STATS_START_DAY, BUDDYX_SUBSCRIBERS_START_DAY, BUDDYX_TEAM_STATS_START_DAY } from '../buddyx/constants';
import type {
  AcquisitionRow,
  ChatterAnalytics,
  ChatterDailyPoint,
  ChatterLeaderboardRow,
  ChatterMetrics,
  ChatterPeriod,
  CreatorAnalytics,
  CreatorDayPoint,
  FanAnalytics,
  FanDetail,
  FanPeriod,
  FanPurchase,
  FanSummary,
  LinkRow,
  MassMessageSummary,
  SpendBucket,
} from '../buddyx/analyticsTypes';
import { serialiseShift } from '../utils/shiftSerialise';
import { expandShiftsForWindow } from '../utils/recurrence';
import { computeTimeWorked } from '../utils/shiftAttendance';
import { getActiveSessionsForUsers, getLedgerEntriesForUsers, getShiftsByRange } from './shiftService';
import { displayNamesFor } from './userService';
import type {
  BuddyxFanDocument,
  BuddyxLinkDocument,
  BuddyxMassMessageDocument,
  BuddyxTeamDayDocument,
  BuddyxTeamPeriodDocument,
  BuddyxTeamRow,
  CaSaleDocument,
  CreatorStatsDayDocument,
} from '@/types/firestore';


// ─── Cache ───────────────────────────────────────────────────────────

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { at: number; value: unknown }>();

async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value as T;
  const value = await load();
  cache.set(key, { at: Date.now(), value });
  if (cache.size > 200) cache.delete(cache.keys().next().value as string);
  return value;
}

// ─── Shared reads ────────────────────────────────────────────────────

function enumerateDays(from: SalaryDayKey, to: SalaryDayKey): SalaryDayKey[] {
  const out: SalaryDayKey[] = [];
  for (let d = from; d <= to && out.length < 400; d = addDays(d, 1)) out.push(d);
  return out;
}

/**
 * Accounts each agent was rostered on in a window: the distinct `creatorIds`
 * across their shift occurrences. Ids, never grouped (rule 9h).
 */
async function rosterForWindow(start: number, end: number): Promise<Map<string, { accounts: Set<string>; shifts: number }>> {
  const docs = await getShiftsByRange(start, end);
  const raw = docs.map(s => ({ ...serialiseShift(s), timeWorkedSeconds: null, attendanceStatus: null }));
  const out = new Map<string, { accounts: Set<string>; shifts: number }>();
  for (const occ of expandShiftsForWindow(raw, start, end)) {
    if (!occ.userId) continue;
    const entry = out.get(occ.userId) ?? { accounts: new Set<string>(), shifts: 0 };
    for (const id of occ.creatorIds ?? []) entry.accounts.add(id);
    entry.shifts += 1;
    out.set(occ.userId, entry);
  }
  return out;
}

/** The creators an agent may see on Fan Analytics: their own roster, this month (D9). */
export async function rosteredCreatorsFor(uid: string, now = Date.now()): Promise<string[]> {
  return cached(`roster:${uid}:${currentMonthKey(now)}`, async () => {
    const [start, end] = monthKeyRange(currentMonthKey(now));
    const docs = await getShiftsByRange(start, end, uid);
    const raw = docs.map(s => ({ ...serialiseShift(s), timeWorkedSeconds: null, attendanceStatus: null }));
    const ids = new Set<string>();
    for (const occ of expandShiftsForWindow(raw, start, end)) {
      if (occ.userId === uid) for (const id of occ.creatorIds ?? []) ids.add(id);
    }
    return [...ids];
  });
}


// ─── Chatter Analytics ───────────────────────────────────────────────
//
// Two sources, one per kind of figure:
//
// - **Revenue** (PPV and tips, gross; counts sold) comes from the sales ledger,
//   `ca-sales` — Infloww history before the cutover, BuddyX after it, with
//   dispute transfers applied. It is the same money the agent's Sales Report
//   shows, so the two pages can never disagree, and it reaches back to October
//   2025.
// - **Activity** (messages, fans chatted, PPVs sent and the unlock rate, online
//   time, reply times) exists only in BuddyX's team reports, from
//   `BUDDYX_TEAM_STATS_START_DAY`. Before that it is `null` — rendered "—",
//   never 0 — and the page says why.

/** One agent's ledger revenue over a range. */
interface LedgerTotals {
  ppvGross: number;
  tipsGross: number;
  tipsCount: number;
  ppvSales: number;
  byDay: Map<string, { ppv: number; tips: number }>;
}

/**
 * Every sale in a range, folded per holder. One field-masked query per month
 * the range touches (a custom range is at most 92 days, so at most 4).
 * Unassigned and removed rows count toward nobody, exactly as on the payslip.
 */
async function readLedger(from: SalaryDayKey, to: SalaryDayKey): Promise<Map<string, LedgerTotals>> {
  const months: string[] = [];
  for (let m = from.slice(0, 7); m <= to.slice(0, 7); m = addMonths(m, 1)) months.push(m);
  const snaps = await Promise.all(
    months.map(m =>
      adminDb.collection('ca-sales').where('month', '==', m).select('userId', 'day', 'kind', 'type', 'signedGross', 'removedAt').get(),
    ),
  );
  const out = new Map<string, LedgerTotals>();
  for (const snap of snaps) {
    for (const doc of snap.docs) {
      const sale = doc.data() as Partial<CaSaleDocument>;
      if (!sale.userId || sale.removedAt || !sale.day || sale.day < from || sale.day > to) continue;
      const t = out.get(sale.userId) ?? { ppvGross: 0, tipsGross: 0, tipsCount: 0, ppvSales: 0, byDay: new Map() };
      const gross = Number(sale.signedGross ?? 0);
      const day = t.byDay.get(sale.day) ?? { ppv: 0, tips: 0 };
      if (saleKindOf(sale) === 'ppv') {
        t.ppvGross += gross;
        t.ppvSales += 1;
        day.ppv += gross;
      } else {
        t.tipsGross += gross;
        t.tipsCount += 1;
        day.tips += gross;
      }
      t.byDay.set(sale.day, day);
      out.set(sale.userId, t);
    }
  }
  return out;
}

/**
 * One agent's figures: revenue from the ledger (when the agent has a uid),
 * activity from their BuddyX rows (when there are any). An unlinked BuddyX
 * chatter has no ledger, so its revenue is BuddyX's own.
 */
function metricsFrom(rows: BuddyxTeamRow[], ledger: LedgerTotals | undefined, withMedians: boolean): ChatterMetrics {
  const sum = (k: keyof BuddyxTeamRow) => rows.reduce((s, r) => s + (Number(r[k]) || 0), 0);
  const hasActivity = rows.length > 0;
  const activity = (value: number) => (hasActivity ? value : null);
  const bxRevenue = sum('ppvGross') + sum('tipsGross');
  const ppvsSent = sum('ppvsSent');
  const ppvsUnlocked = sum('ppvsUnlocked');
  const totalMessages = sum('totalMessages');
  const onlineMs = sum('onlineMs');
  // Medians come only from a whole-period row; a sum of days has none. An agent
  // with two BuddyX ids has two medians that cannot be combined, so the first
  // is used — one id per agent is the normal case.
  const timed = withMedians ? rows.find(r => r.medianResponseTimeMs !== null) : undefined;
  return {
    ppvGross: round2(ledger ? ledger.ppvGross : sum('ppvGross')),
    tipsGross: round2(ledger ? ledger.tipsGross : sum('tipsGross')),
    tipsCount: ledger ? ledger.tipsCount : sum('tipsCount'),
    ppvSales: ledger ? ledger.ppvSales : ppvsUnlocked,
    ppvsSent: activity(ppvsSent),
    ppvsUnlocked: activity(ppvsUnlocked),
    unlockRate: hasActivity && ppvsSent > 0 ? round2((ppvsUnlocked / ppvsSent) * 100) : null,
    ppvRate: hasActivity && totalMessages > 0 ? round2(ppvsSent / totalMessages) : null,
    fansChatted: activity(sum('fansChatted')),
    totalMessages: activity(totalMessages),
    onlineMs: activity(onlineMs),
    medianResponseTimeMs: timed?.medianResponseTimeMs ?? null,
    p75ResponseTimeMs: timed?.p75ResponseTimeMs ?? null,
    // BuddyX revenue over BuddyX online time — both from the same window, so a
    // range that straddles the start of BuddyX does not inflate the rate.
    revenuePerOnlineHour: onlineMs > 0 ? round2(bxRevenue / (onlineMs / 3_600_000)) : null,
  };
}

/** Group a breakdown by Bluu uid; unmapped chatters (and the manager) keep their chatter id. */
function groupRows(rows: BuddyxTeamRow[]): Map<string, BuddyxTeamRow[]> {
  const out = new Map<string, BuddyxTeamRow[]>();
  for (const row of rows) {
    const key = row.uid ?? `chatter:${row.chatterId}`;
    const list = out.get(key) ?? [];
    list.push(row);
    out.set(key, list);
  }
  return out;
}

function massSummary(docs: BuddyxMassMessageDocument[]): MassMessageSummary {
  const sent = docs.filter(d => d.sentDate);
  const priced = sent.filter(d => d.price > 0);
  return {
    count: sent.length,
    avgPrice: priced.length ? round2(priced.reduce((s, d) => s + d.price, 0) / priced.length) : null,
    unsent: sent.filter(d => d.unsent).length,
  };
}

function resolvePeriod(period: ChatterPeriod, from: string | null, to: string | null, now: number) {
  const today = currentDayKey(now);
  const month = currentMonthKey(now);
  switch (period) {
    case 'mtd':
      return { from: `${month}-01`, to: today };
    case 'prev-month': {
      const prev = addMonths(month, -1);
      const [, end] = monthKeyRange(prev);
      return { from: `${prev}-01`, to: toDayKey(end - 1) };
    }
    case '7d':
      return { from: toDayKey(now - 7 * 86_400_000), to: today };
    case '30d':
      return { from: toDayKey(now - 30 * 86_400_000), to: today };
    case 'custom':
      return { from: from!, to: to! };
  }
}

export async function getChatterAnalytics(params: {
  period: ChatterPeriod;
  from: string | null;
  to: string | null;
  viewerUid: string;
  isAdmin: boolean;
  now?: number;
}): Promise<ChatterAnalytics> {
  const now = params.now ?? Date.now();
  const range = resolvePeriod(params.period, params.from, params.to, now);
  const key = `chatters:${params.period}:${range.from}:${range.to}`;
  const activityFrom = BUDDYX_TEAM_STATS_START_DAY;
  const hasActivityWindow = range.to >= activityFrom;

  // The team-wide part is cached once and projected per viewer below, so an
  // agent and an admin share the same reads.
  const team = await cached(key, async () => {
    // BuddyX only holds activity from its start day; asking for earlier days is
    // a read that can only miss.
    const days = hasActivityWindow ? enumerateDays(range.from > activityFrom ? range.from : activityFrom, range.to) : [];
    const periodId = params.period === 'custom' ? `custom-${range.from}-${range.to}` : params.period;
    const [daySnaps, periodSnap, massSnap, ledger] = await Promise.all([
      days.length ? adminDb.getAll(...days.map(d => adminDb.collection('buddyx-team-days').doc(d))) : Promise.resolve([]),
      hasActivityWindow ? adminDb.collection('buddyx-team-periods').doc(periodId).get() : Promise.resolve(null),
      hasActivityWindow
        ? adminDb
            .collection('buddyx-mass-messages')
            .where('day', '>=', range.from)
            .where('day', '<=', range.to)
            .select('uid', 'sentBy', 'price', 'unsent', 'sentDate')
            .get()
        : Promise.resolve(null),
      readLedger(range.from, range.to),
    ]);
    const dayDocs = daySnaps.filter(s => s.exists).map(s => s.data() as BuddyxTeamDayDocument);
    const periodDoc = periodSnap?.exists ? (periodSnap.data() as BuddyxTeamPeriodDocument) : null;

    // Whole-period rows when we have them (exact medians); otherwise summed days.
    const rows = periodDoc?.breakdown ?? dayDocs.flatMap(d => d.breakdown ?? []);
    return {
      rows,
      hasMedians: Boolean(periodDoc),
      ledger,
      mass: (massSnap?.docs ?? []).map(d => d.data() as BuddyxMassMessageDocument),
    };
  });

  const grouped = groupRows(team.rows);
  const uidsWithData = new Set([...[...grouped.keys()].filter(k => !k.startsWith('chatter:')), ...team.ledger.keys()]);
  const metricsFor = (uid: string) => metricsFrom(grouped.get(uid) ?? [], team.ledger.get(uid), team.hasMedians);
  const teamMetrics = [...uidsWithData].map(uid => ({ uid, metrics: metricsFor(uid) }));
  const me = uidsWithData.has(params.viewerUid) ? metricsFor(params.viewerUid) : null;

  const myDays = team.ledger.get(params.viewerUid)?.byDay ?? new Map<string, { ppv: number; tips: number }>();
  const daily: ChatterDailyPoint[] = [...myDays.entries()]
    .map(([day, v]) => ({ day, ppvGross: round2(v.ppv), tipsGross: round2(v.tips) }))
    .sort((a, b) => a.day.localeCompare(b.day));

  const result: ChatterAnalytics = {
    period: params.period,
    from: range.from,
    to: range.to,
    activityFrom,
    hasMedians: team.hasMedians,
    me,
    daily,
    mass: massSummary(team.mass.filter(m => m.uid === params.viewerUid)),
    benchmarks: computeBenchmarks(me, teamMetrics, params.viewerUid),
    leaderboard: null,
    rosteredOffline: null,
  };
  if (!params.isAdmin) return result;

  // ── Admin: the named leaderboard, and the integrity check ──
  const [start] = dayKeyRange(range.from);
  const [, end] = dayKeyRange(range.to);
  const windowEnd = Math.min(end, now);
  // Online-vs-clocked and "never online" only mean anything where BuddyX could
  // have seen the agent, so both use the part of the range it covers.
  const activityStart = Math.max(start, dayKeyRange(activityFrom)[0]);
  const [roster, activityRoster] = await Promise.all([
    rosterForWindow(start, windowEnd),
    hasActivityWindow && activityStart > start ? rosterForWindow(activityStart, windowEnd) : Promise.resolve(null),
  ]);
  const offlineRoster = hasActivityWindow ? activityRoster ?? roster : new Map<string, { accounts: Set<string>; shifts: number }>();
  const uids = [...new Set([...uidsWithData, ...roster.keys()])];
  const [names, timeLedger, active] = await Promise.all([
    displayNamesFor(uids),
    hasActivityWindow ? getLedgerEntriesForUsers(uids, activityStart - 8 * 3_600_000, windowEnd) : Promise.resolve(new Map()),
    hasActivityWindow ? getActiveSessionsForUsers(uids) : Promise.resolve(new Map()),
  ]);

  const rowFor = (uid: string | null, metrics: ChatterMetrics, bxRows: BuddyxTeamRow[]): ChatterLeaderboardRow => {
    const accounts = uid ? roster.get(uid)?.accounts.size ?? 0 : 0;
    const chatter = bxRows[0];
    return {
      ...metrics,
      uid,
      chatterId: chatter?.chatterId ?? '',
      name: uid
        ? names.get(uid) ?? chatter?.chatterName ?? uid
        : `${chatter?.chatterName ?? `Chatter ${chatter?.chatterId}`} (not linked)`,
      clockedMs:
        uid && hasActivityWindow
          ? computeTimeWorked(activityStart, windowEnd, timeLedger.get(uid) ?? [], active.get(uid)) * 1000
          : null,
      accounts,
      revenuePerAccount: accounts > 0 ? round2((metrics.ppvGross + metrics.tipsGross) / accounts) : null,
      mass: massSummary(team.mass.filter(m => (uid ? m.uid === uid : m.sentBy === chatter?.chatterId))),
    };
  };

  result.leaderboard = [
    ...teamMetrics.map(t => rowFor(t.uid, t.metrics, grouped.get(t.uid) ?? [])),
    ...[...grouped.entries()]
      .filter(([k]) => k.startsWith('chatter:'))
      .map(([, rows]) => rowFor(null, metricsFrom(rows, undefined, team.hasMedians), rows)),
  ].sort((a, b) => b.ppvGross + b.tipsGross - (a.ppvGross + a.tipsGross));

  const online = new Set(teamMetrics.filter(t => (t.metrics.onlineMs ?? 0) > 0).map(t => t.uid));
  result.rosteredOffline = [...offlineRoster.entries()]
    .filter(([uid, r]) => r.shifts > 0 && !online.has(uid))
    .map(([uid, r]) => ({ uid, name: names.get(uid) ?? uid, shifts: r.shifts }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return result;
}

// ─── Fan Analytics ───────────────────────────────────────────────────

const AT_RISK_QUIET_DAYS = 14;
const AT_RISK_WINDOW_DAYS = 60;

const SPEND_BUCKETS: Array<{ label: string; min: number; max: number | null }> = [
  { label: 'Under $25', min: 0, max: 25 },
  { label: '$25–100', min: 25, max: 100 },
  { label: '$100–250', min: 100, max: 250 },
  { label: '$250–500', min: 250, max: 500 },
  { label: '$500–1k', min: 500, max: 1000 },
  { label: '$1k+', min: 1000, max: null },
];

function periodMonths(period: FanPeriod, now: number): string[] | null {
  const month = currentMonthKey(now);
  switch (period) {
    case 'month':
      return [month];
    case 'prev-month':
      return [addMonths(month, -1)];
    case '3m':
      return [addMonths(month, -2), addMonths(month, -1), month];
    case 'lifetime':
      return null;
  }
}

function summariseFan(doc: BuddyxFanDocument, months: string[] | null): FanSummary {
  let lifetimeTips = 0;
  let lifetimePpv = 0;
  let periodTips = 0;
  let periodPpv = 0;
  let last: number | null = null;
  let first: number | null = null;
  for (const [month, v] of Object.entries(doc.spendByMonth ?? {})) {
    lifetimeTips += v.tips;
    lifetimePpv += v.ppv;
    if (!months || months.includes(month)) {
      periodTips += v.tips;
      periodPpv += v.ppv;
    }
    if (v.last && (last === null || v.last > last)) last = v.last;
    if (v.first && (first === null || v.first < first)) first = v.first;
  }
  const lifetime = lifetimeTips + lifetimePpv;
  const usual =
    lifetime <= 0 ? null : lifetimeTips / lifetime >= 0.75 ? 'tips' : lifetimePpv / lifetime >= 0.75 ? 'ppv' : 'mixed';
  return {
    creatorId: doc.creatorId,
    fanId: doc.fanId,
    name: doc.name || doc.salesName || null,
    periodSpend: round2(periodTips + periodPpv),
    periodTips: round2(periodTips),
    periodPpv: round2(periodPpv),
    lifetimeSpend: round2(lifetime),
    lifetimeTips: round2(lifetimeTips),
    lifetimePpv: round2(lifetimePpv),
    lastPurchaseAt: last,
    firstSeenAt: first,
    usual,
  };
}

async function readFans(creatorIds: string[]): Promise<BuddyxFanDocument[]> {
  const out: BuddyxFanDocument[] = [];
  for (let i = 0; i < creatorIds.length; i += 30) {
    const snap = await adminDb
      .collection('buddyx-fans')
      .where('creatorId', 'in', creatorIds.slice(i, i + 30))
      .select('creatorId', 'fanId', 'name', 'salesName', 'spendByMonth', 'acquisition', 'subscriptions', 'isStacker', 'linkTotalSpent')
      .get();
    for (const doc of snap.docs) out.push(doc.data() as BuddyxFanDocument);
  }
  return out;
}

export async function resolveFanScope(params: { viewerUid: string; isAdmin: boolean; requested: string | null }) {
  const scope = params.isAdmin ? await mappedCreatorIds() : await rosteredCreatorsFor(params.viewerUid);
  const creatorIds = params.requested ? scope.filter(id => id === params.requested) : scope;
  return { scope, creatorIds };
}

export async function getFanAnalytics(params: {
  viewerUid: string;
  isAdmin: boolean;
  creatorId: string | null;
  period: FanPeriod;
  now?: number;
}): Promise<FanAnalytics> {
  const now = params.now ?? Date.now();
  const { scope, creatorIds } = await resolveFanScope({
    viewerUid: params.viewerUid,
    isAdmin: params.isAdmin,
    requested: params.creatorId,
  });
  const empty: FanAnalytics = {
    period: params.period,
    creatorIds,
    scope,
    kpis: { spenders: 0, revenue: 0, revenuePerSpender: null, whaleShare: null, trialConversion: null, trialFans: 0 },
    atRisk: [],
    topSpenders: [],
    distribution: SPEND_BUCKETS.map(b => ({ ...b, fans: 0, revenue: 0 })),
    subscribers: { new: 0, returning: 0, trial: 0 },
    acquisition: params.isAdmin ? [] : null,
    atRiskRule: { quietDays: AT_RISK_QUIET_DAYS, windowDays: AT_RISK_WINDOW_DAYS },
  };
  if (creatorIds.length === 0) return empty;

  const months = periodMonths(params.period, now);
  const key = `fans:${params.isAdmin ? 'admin' : 'agent'}:${[...creatorIds].sort().join(',')}`;
  const { fans, links, subs } = await cached(key, async () => {
    const [fansRead, linkSnap, subSnap] = await Promise.all([
      readFans(creatorIds),
      // Acquisition is admin-only; an agent's view never reads the link table.
      params.isAdmin
        ? adminDb.collection('buddyx-links').select('creatorId', 'linkId', 'kind', 'name', 'cost', 'revenue', 'fansCount').get()
        : Promise.resolve(null),
      adminDb
        .collection('buddyx-subscribers')
        .where('day', '>=', toDayKey(now - 120 * 86_400_000))
        .select('creatorId', 'subType', 'isTrial', 'isCreator', 'day')
        .get(),
    ]);
    const inScope = new Set(creatorIds);
    return {
      fans: fansRead,
      links: (linkSnap?.docs ?? []).map(d => d.data() as BuddyxLinkDocument).filter(l => l.creatorId && inScope.has(l.creatorId)),
      subs: subSnap.docs
        .map(d => d.data() as { creatorId: string | null; subType: string | null; isTrial: boolean; isCreator: boolean; day: string })
        .filter(s => s.creatorId && inScope.has(s.creatorId) && !s.isCreator),
    };
  });

  const summaries = fans.map(f => summariseFan(f, months));
  const spenders = summaries.filter(s => s.periodSpend > 0).sort((a, b) => b.periodSpend - a.periodSpend);
  const revenue = round2(spenders.reduce((s, f) => s + f.periodSpend, 0));
  const whaleCount = Math.max(1, Math.ceil(spenders.length * 0.1));
  const whaleRevenue = spenders.slice(0, whaleCount).reduce((s, f) => s + f.periodSpend, 0);

  const trialFans = fans.filter(f => f.acquisition?.kind === 'free-trial' || f.subscriptions?.isTrial);
  const trialPaid = trialFans.filter(f => summariseFan(f, null).lifetimeSpend > 0);

  const quietSince = now - AT_RISK_QUIET_DAYS * 86_400_000;
  const windowSince = now - AT_RISK_WINDOW_DAYS * 86_400_000;
  const atRisk = summaries
    .filter(s => s.lastPurchaseAt !== null && s.lastPurchaseAt < quietSince && s.lastPurchaseAt >= windowSince)
    .sort((a, b) => b.lifetimeSpend - a.lifetimeSpend)
    .slice(0, 50);

  const distribution: SpendBucket[] = SPEND_BUCKETS.map(b => {
    const inBucket = spenders.filter(s => s.periodSpend >= b.min && (b.max === null || s.periodSpend < b.max));
    return { ...b, fans: inBucket.length, revenue: round2(inBucket.reduce((s, f) => s + f.periodSpend, 0)) };
  });

  // Subscribers in the period (the subscriber feed starts 2026-09-25).
  const periodFrom = months ? `${months[0]}-01` : '0000-00-00';
  const periodTo = months ? toDayKey(monthKeyRange(months[months.length - 1])[1] - 1) : '9999-99-99';
  const periodSubs = subs.filter(s => s.day >= periodFrom && s.day <= periodTo);

  let acquisition: AcquisitionRow[] | null = null;
  if (params.isAdmin) {
    acquisition = links
      .map(l => ({
        creatorId: l.creatorId,
        linkId: l.linkId,
        kind: l.kind,
        name: l.name,
        fans: l.fansCount,
        revenue: l.revenue,
        revenuePerFan: l.fansCount > 0 ? round2(l.revenue / l.fansCount) : null,
        cost: l.cost,
        roi: l.cost > 0 ? round2((l.revenue - l.cost) / l.cost) : null,
      }))
      .sort((a, b) => b.revenue - a.revenue);
  }

  return {
    ...empty,
    kpis: {
      spenders: spenders.length,
      revenue,
      revenuePerSpender: spenders.length ? round2(revenue / spenders.length) : null,
      whaleShare: revenue > 0 ? Math.round((whaleRevenue / revenue) * 1000) / 1000 : null,
      trialConversion: trialFans.length ? Math.round((trialPaid.length / trialFans.length) * 1000) / 1000 : null,
      trialFans: trialFans.length,
    },
    atRisk,
    topSpenders: spenders.slice(0, 50),
    distribution,
    subscribers: {
      new: periodSubs.filter(s => s.subType === 'new_subscriber').length,
      returning: periodSubs.filter(s => s.subType === 'returning_subscriber').length,
      trial: periodSubs.filter(s => s.isTrial || s.subType === 'new_subscriber_trial').length,
    },
    acquisition,
  };
}

/** The fan drawer. `null` when the fan does not exist **or** is outside the viewer's scope. */
export async function getFanDetail(params: {
  viewerUid: string;
  isAdmin: boolean;
  creatorId: string;
  fanId: string;
}): Promise<FanDetail | null> {
  const { scope } = await resolveFanScope({ viewerUid: params.viewerUid, isAdmin: params.isAdmin, requested: null });
  if (!scope.includes(params.creatorId)) return null;

  const [fanSnap, salesSnap, subsSnap] = await Promise.all([
    adminDb.collection('buddyx-fans').doc(`${params.creatorId}_${params.fanId}`).get(),
    adminDb
      .collection('ca-sales')
      .where('fanId', '==', params.fanId)
      .where('creatorId', '==', params.creatorId)
      .select('saleId', 'occurredAt', 'kind', 'type', 'signedGross', 'source', 'userId', 'removedAt')
      .get(),
    adminDb.collection('buddyx-subscribers').where('fanId', '==', params.fanId).get(),
  ]);
  if (!fanSnap.exists) return null;
  const fan = fanSnap.data() as BuddyxFanDocument;
  const sales = salesSnap.docs.map(d => d.data() as CaSaleDocument).filter(s => !s.removedAt);
  const names = params.isAdmin ? await displayNamesFor(sales.map(s => s.userId)) : new Map<string, string>();
  const label = (uid: string | null) =>
    !uid ? null : params.isAdmin ? names.get(uid) ?? 'Unknown' : uid === params.viewerUid ? 'You' : 'Team';

  const purchases: FanPurchase[] = sales
    .map(s => ({
      saleId: s.saleId,
      occurredAt: s.occurredAt?.toDate?.()?.toISOString() ?? '',
      kind: saleKindOf(s),
      type: s.type,
      gross: s.signedGross,
      source: saleSourceOf(s, s.occurredAt?.toMillis?.() ?? 0),
      earnedBy: label(s.userId ?? null),
    }))
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)) as FanPurchase[];

  const earned = new Map<string, { label: string; gross: number; count: number }>();
  for (const p of purchases) {
    const key = p.earnedBy ?? 'Unassigned';
    const entry = earned.get(key) ?? { label: key, gross: 0, count: 0 };
    entry.gross = round2(entry.gross + p.gross);
    entry.count += 1;
    earned.set(key, entry);
  }

  return {
    fan: summariseFan(fan, null),
    isStacker: fan.isStacker === true,
    acquisition: fan.acquisition ?? null,
    linkTotalSpent: fan.linkTotalSpent ?? null,
    purchases,
    subscriptions: subsSnap.docs
      .map(d => d.data())
      .filter(s => s.creatorId === params.creatorId)
      .map(s => ({
        id: String(s.id),
        at: (s.subscribedAt as Timestamp | null)?.toDate?.()?.toISOString() ?? null,
        subType: (s.subType as string | null) ?? null,
        isTrial: s.isTrial === true,
        priceGross: Number(s.priceGross ?? 0),
      }))
      .sort((a, b) => (b.at ?? '').localeCompare(a.at ?? '')),
    earnedBy: [...earned.values()].sort((a, b) => b.gross - a.gross),
  };
}

// ─── OnlyFans Analytics ──────────────────────────────────────────────

/** The earliest day the creator history reaches (the Infloww export's first day). */
export { CREATOR_HISTORY_START_DAY } from '../buddyx/constants';

function pointFrom(d: CreatorStatsDayDocument): CreatorDayPoint {
  return {
    day: d.day,
    source: d.source,
    totalGross: d.totalGross,
    subsGross: d.subsGross,
    tipsGross: d.tipsGross,
    messagesGross: d.messagesGross,
    newSubs: d.newSubs,
    fansChatted: d.fansChatted,
    messagesSent: d.messagesSent,
    ppvsSent: d.ppvsSent,
    ppvsUnlocked: d.ppvsUnlocked ?? null,
    replyTimeMs: d.replyTimeMs,
    massMessages: d.massMessages ?? null,
  };
}

async function readCreatorDays(from: string, to: string): Promise<CreatorStatsDayDocument[]> {
  return cached(`creator-days:${from}:${to}`, async () => {
    const snap = await adminDb.collection('creator-stats-days').where('day', '>=', from).where('day', '<=', to).get();
    return snap.docs.map(d => d.data() as CreatorStatsDayDocument);
  });
}

export async function getCreatorAnalytics(params: { from: string; to: string; creatorId: string | null; now?: number }): Promise<CreatorAnalytics> {
  const now = params.now ?? Date.now();
  const { from, to, creatorId } = params;
  const span = enumerateDays(from, to).length;
  const prevFrom = addDays(from, -span);
  const prevTo = addDays(from, -1);
  const month = currentMonthKey(now);
  const monthFrom = `${month}-01`;
  const today = currentDayKey(now);

  const [rangeDays, prevDays, mtdDays, linkSnap, massSnap, subsSnap, modelSnap] = await Promise.all([
    readCreatorDays(from, to),
    readCreatorDays(prevFrom, prevTo),
    readCreatorDays(monthFrom, today),
    cached('links:all', () => adminDb.collection('buddyx-links').get().then(s => s.docs.map(d => d.data() as BuddyxLinkDocument))),
    cached(`mass:${from}:${to}`, () =>
      adminDb.collection('buddyx-mass-messages').where('day', '>=', from).where('day', '<=', to).get()
        .then(s => s.docs.map(d => d.data() as BuddyxMassMessageDocument)),
    ),
    cached(`subs:${from}:${to}`, () =>
      adminDb
        .collection('buddyx-subscribers')
        .where('day', '>=', from > BUDDYX_SUBSCRIBERS_START_DAY ? from : BUDDYX_SUBSCRIBERS_START_DAY)
        .where('day', '<=', to)
        .select('creatorId', 'subType', 'isTrial', 'isCreator', 'day')
        .get()
        .then(s => s.docs.map(d => d.data() as { creatorId: string | null; subType: string | null; isTrial: boolean; isCreator: boolean; day: string })),
    ),
    mappedCreatorIds(),
  ]);

  const mappedIds = new Set(modelSnap);
  const scoped = <T extends { creatorId: string | null }>(rows: T[]) => (creatorId ? rows.filter(r => r.creatorId === creatorId) : rows);

  // ── Roster cards — always every creator, so the roster can be the selector ──
  const byCreator = new Map<string, CreatorStatsDayDocument[]>();
  for (const d of rangeDays) {
    const list = byCreator.get(d.creatorId) ?? [];
    list.push(d);
    byCreator.set(d.creatorId, list);
  }
  const prevByCreator = new Map<string, number>();
  for (const d of prevDays) prevByCreator.set(d.creatorId, round2((prevByCreator.get(d.creatorId) ?? 0) + (d.totalGross ?? 0)));
  const days = enumerateDays(from, to);

  const roster = [...new Set([...byCreator.keys(), ...mappedIds])].map(id => {
    const list = byCreator.get(id) ?? [];
    const byDay = new Map(list.map(d => [d.day, d]));
    const sum = (k: 'totalGross' | 'subsGross' | 'tipsGross' | 'messagesGross') => round2(list.reduce((s, d) => s + (d[k] ?? 0), 0));
    return {
      creatorId: id,
      totalGross: sum('totalGross'),
      previousGross: prevByCreator.has(id) ? prevByCreator.get(id)! : null,
      subsGross: sum('subsGross'),
      tipsGross: sum('tipsGross'),
      messagesGross: sum('messagesGross'),
      spark: days.map(day => ({ day, value: byDay.get(day)?.totalGross ?? null })),
    };
  }).sort((a, b) => b.totalGross - a.totalGross);

  // ── Daily series for the selection (summed across creators for "All") ──
  const selected = scoped(rangeDays);
  const dailyMap = new Map<string, CreatorDayPoint & { creatorCount: number }>();
  const addNullable = (a: number | null, b: number | null) => (a === null && b === null ? null : round2((a ?? 0) + (b ?? 0)));
  for (const d of selected) {
    const p = pointFrom(d);
    const prev = dailyMap.get(d.day);
    if (!prev) {
      dailyMap.set(d.day, { ...p, creatorCount: 1 });
      continue;
    }
    dailyMap.set(d.day, {
      day: d.day,
      source: prev.source === 'buddyx' || p.source === 'buddyx' ? 'buddyx' : 'infloww',
      totalGross: addNullable(prev.totalGross, p.totalGross),
      subsGross: addNullable(prev.subsGross, p.subsGross),
      tipsGross: addNullable(prev.tipsGross, p.tipsGross),
      messagesGross: addNullable(prev.messagesGross, p.messagesGross),
      newSubs: addNullable(prev.newSubs, p.newSubs),
      fansChatted: addNullable(prev.fansChatted, p.fansChatted),
      messagesSent: addNullable(prev.messagesSent, p.messagesSent),
      ppvsSent: addNullable(prev.ppvsSent, p.ppvsSent),
      ppvsUnlocked: addNullable(prev.ppvsUnlocked, p.ppvsUnlocked),
      // A reply time does not add across creators; keep the slower, the honest bound.
      replyTimeMs: prev.replyTimeMs === null ? p.replyTimeMs : p.replyTimeMs === null ? prev.replyTimeMs : Math.max(prev.replyTimeMs, p.replyTimeMs),
      massMessages: addNullable(prev.massMessages, p.massMessages),
      creatorCount: prev.creatorCount + 1,
    });
  }
  const daily = [...dailyMap.values()].sort((a, b) => a.day.localeCompare(b.day));

  // ── Subscribers ──
  const subsByDay = new Map<string, { day: string; new: number; returning: number; trial: number }>();
  for (const s of scoped(subsSnap)) {
    if (s.isCreator) continue;
    const entry = subsByDay.get(s.day) ?? { day: s.day, new: 0, returning: 0, trial: 0 };
    if (s.isTrial || s.subType === 'new_subscriber_trial') entry.trial += 1;
    else if (s.subType === 'returning_subscriber') entry.returning += 1;
    else entry.new += 1;
    subsByDay.set(s.day, entry);
  }

  // ── Links ──
  const links: LinkRow[] = scoped(linkSnap)
    .map(l => {
      const series = Object.entries(l.series ?? {}).sort(([a], [b]) => a.localeCompare(b));
      return {
        creatorId: l.creatorId,
        linkId: l.linkId,
        kind: l.kind,
        name: l.name,
        url: l.url,
        archived: l.archived,
        transitions: l.transitions,
        subscribers: l.subscribers,
        conversion: l.kind === 'tracking' && l.transitions ? Math.round((l.subscribers / l.transitions) * 1000) / 1000 : null,
        revenue: l.revenue,
        fans: l.fansCount,
        revenuePerFan: l.fansCount > 0 ? round2(l.revenue / l.fansCount) : null,
        cost: l.cost,
        roi: l.cost > 0 ? round2((l.revenue - l.cost) / l.cost) : null,
        stackers: l.stackersCount,
        // Daily *new* revenue, so the row's mark is a rate (DESIGN.md §5, the
        // metric roster's cumulative-measure rule).
        spark: series.map(([day, v], i) => ({ day, value: i === 0 ? 0 : Math.max(0, round2(v.revenue - series[i - 1][1].revenue)) })),
      };
    })
    .sort((a, b) => b.revenue - a.revenue);

  const best = linkSnap
    .filter(l => l.fansCount >= 5)
    .map(l => ({ name: l.name, creatorId: l.creatorId, revenuePerFan: round2(l.revenue / l.fansCount) }))
    .sort((a, b) => b.revenuePerFan - a.revenuePerFan)[0] ?? null;

  // ── Mass messages ──
  const mass = scoped(massSnap).filter(m => m.sentDate);
  const priced = mass.filter(m => m.price > 0);

  // ── Messaging & rev share ──
  const sumSel = (k: keyof CreatorStatsDayDocument) => selected.reduce((s, d) => s + (Number(d[k]) || 0), 0);
  const replies = selected.filter(d => d.source === 'buddyx' && d.replyTimeMs !== null).map(d => d.replyTimeMs as number).sort((a, b) => a - b);
  const revShareRows = selected.filter(d => typeof d.revShareGross === 'number');

  const total = roster.reduce((s, r) => s + r.totalGross, 0);
  const recent = toDayKey(now - 7 * 86_400_000);

  return {
    from,
    to,
    creatorId,
    cutoverDay: BUDDYX_CREATOR_STATS_START_DAY,
    kpis: {
      earningsMtd: round2(mtdDays.reduce((s, d) => s + (d.totalGross ?? 0), 0)),
      newSubsMtd: mtdDays.reduce((s, d) => s + (d.newSubs ?? 0), 0),
      bestLink: best,
      activeCreators: new Set(mtdDays.filter(d => d.source === 'buddyx' && d.day >= recent).map(d => d.creatorId)).size,
    },
    roster,
    daily,
    subscribers: [...subsByDay.values()].sort((a, b) => a.day.localeCompare(b.day)),
    subscribersFrom: BUDDYX_SUBSCRIBERS_START_DAY,
    links,
    mass: {
      count: mass.length,
      avgPrice: priced.length ? round2(priced.reduce((s, m) => s + m.price, 0) / priced.length) : null,
      unsentRate: mass.length ? Math.round((mass.filter(m => m.unsent).length / mass.length) * 1000) / 1000 : null,
    },
    messaging: {
      fansChatted: sumSel('fansChatted'),
      ppvsSent: sumSel('ppvsSent'),
      ppvsUnlocked: sumSel('ppvsUnlocked'),
      replyTimeMs: replies.length ? replies[Math.floor(replies.length / 2)] : null,
    },
    revShareGross: revShareRows.length ? round2(revShareRows.reduce((s, d) => s + (d.revShareGross ?? 0), 0)) : null,
    comparison: roster
      .filter(r => r.totalGross > 0 || (r.previousGross ?? 0) > 0)
      .map(r => ({
        creatorId: r.creatorId,
        gross: r.totalGross,
        share: total > 0 ? Math.round((r.totalGross / total) * 1000) / 1000 : 0,
        previousGross: r.previousGross,
      })),
  };
}
