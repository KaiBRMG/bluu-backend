/**
 * The three BuddyX analytics read models — Chatter, Fan and OnlyFans Analytics.
 *
 * **Firestore only.** Nothing here calls the BuddyX API; the sync wrote what
 * these read, and a page view never costs an API request. Each model is cached
 * in module scope for 60s per scope key (the routes add `private, max-age=60`),
 * so a page revisited inside a minute costs nothing at all.
 *
 * Scope is enforced here, not in the client:
 * - Chatter Analytics — everyone gets the named **sales** board (gross, counts,
 *   per clocked hour, accounts — nothing else of a colleague); `ca-admin` also
 *   gets unlinked BuddyX chatters and the integrity flags.
 * - Fan Analytics — an agent gets the creators they are rostered on this month;
 *   `ca-admin` gets all (D9). The fan detail refuses a fan outside that scope.
 * - OnlyFans Analytics — everyone with the page sees every creator (internal).
 */
import 'server-only';
import { adminDb } from '../firebase-admin';
import {
  addDays,
  addMonths,
  currentDayKey,
  currentMonthKey,
  dayKeyRange,
  daysInMonth,
  enumerateDays,
  monthKeyRange,
  toDayKey,
  type SalaryDayKey,
} from '../salary/salaryDate';
import { round2 } from '../salary/salaryEngine';
import { saleKindOf } from '../salary/saleTypes';
import { resolveFanName } from '../fans/fanIdentity';
import { mappedCreatorIds } from './buddyxMappingService';
import {
  BUDDYX_CREATOR_STATS_START_DAY,
  CREATOR_HISTORY_START_DAY,
  BUDDYX_SUBSCRIBERS_START_DAY,
  BUDDYX_TEAM_STATS_START_DAY,
  TEAM_PERIODS,
  modelIdOfUnmappedKey,
  unmappedModelKey,
} from '../buddyx/constants';
import type {
  AcquisitionRow,
  ChatterAnalytics,
  ChatterDailyPoint,
  ChatterMetrics,
  ChatterPeriod,
  ChatterReport,
  CreatorAnalytics,
  CreatorIdentity,
  CreatorDayPoint,
  FanAnalytics,
  FanPeriod,
  FanSummary,
  LinkRow,
  MassMessageSummary,
  ReportAccount,
  SalesBoardRow,
  SpendBucket,
  TeamSales,
} from '../buddyx/analyticsTypes';
import { BOARD_RATE_MAX_DAYS } from '../buddyx/analyticsTypes';
import { serialiseShift } from '../utils/shiftSerialise';
import { expandShiftsForWindow } from '../utils/recurrence';
import { computeTimeWorked } from '../utils/shiftAttendance';
import { getActiveSessionsForUsers, getLedgerEntriesForUsers, getShiftsByRange } from './shiftService';
import { getIntegrityDays } from './integrityService';
import { LEDGER_LOOKBACK_MS } from '../buddyx/coverage';
import {
  reportReads,
  reportShifts,
  flagsForAgent,
  readTeamHours,
  sortFlags,
  summariseIntegrity,
} from './chatterIntegrityService';
import { getUserById, userLabelsFor } from './userService';
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

/** One sale, as the read models need it. */
interface LedgerSale {
  userId: string;
  day: string;
  /** `occurredAt`, ms. */
  at: number;
  kind: 'ppv' | 'tip';
  gross: number;
  /** Creator id when the sale has one, else the name it was imported under. */
  accountKey: string;
  accountName: string;
}

/** One agent's ledger revenue over a range. */
interface LedgerTotals {
  ppvGross: number;
  tipsGross: number;
  tipsCount: number;
  ppvSales: number;
  byDay: Map<string, { ppv: number; tips: number }>;
}

/**
 * One month of the sales ledger, field-masked and cached per month — a period
 * and the one it is compared against usually share a month, so the comparison
 * does not read it twice. Unassigned and removed rows count toward nobody,
 * exactly as on the payslip.
 */
function readLedgerMonth(month: string): Promise<LedgerSale[]> {
  return cached(`sales:${month}`, async () => {
    const snap = await adminDb
      .collection('ca-sales')
      .where('month', '==', month)
      .select('userId', 'day', 'kind', 'type', 'signedGross', 'removedAt', 'occurredAt', 'creatorId', 'creatorName')
      .get();
    const out: LedgerSale[] = [];
    for (const doc of snap.docs) {
      const sale = doc.data() as Partial<CaSaleDocument>;
      if (!sale.userId || sale.removedAt || !sale.day) continue;
      out.push({
        userId: sale.userId,
        day: sale.day,
        at: sale.occurredAt?.toMillis?.() ?? 0,
        kind: saleKindOf(sale) === 'ppv' ? 'ppv' : 'tip',
        gross: Number(sale.signedGross ?? 0),
        accountKey: sale.creatorId || sale.creatorName || '',
        accountName: sale.creatorName || '',
      });
    }
    return out;
  });
}

/** Every held sale in a range — one cached month read per month it touches. */
async function readSales(from: SalaryDayKey, to: SalaryDayKey): Promise<LedgerSale[]> {
  const months: string[] = [];
  for (let m = from.slice(0, 7); m <= to.slice(0, 7); m = addMonths(m, 1)) months.push(m);
  const perMonth = await Promise.all(months.map(readLedgerMonth));
  return perMonth.flat().filter(x => x.day >= from && x.day <= to);
}

/** Sales folded per holder. */
function foldLedger(sales: LedgerSale[]): Map<string, LedgerTotals> {
  const out = new Map<string, LedgerTotals>();
  for (const sale of sales) {
    const t = out.get(sale.userId) ?? { ppvGross: 0, tipsGross: 0, tipsCount: 0, ppvSales: 0, byDay: new Map() };
    const day = t.byDay.get(sale.day) ?? { ppv: 0, tips: 0 };
    if (sale.kind === 'ppv') {
      t.ppvGross += sale.gross;
      t.ppvSales += 1;
      day.ppv += sale.gross;
    } else {
      t.tipsGross += sale.gross;
      t.tipsCount += 1;
      day.tips += sale.gross;
    }
    t.byDay.set(sale.day, day);
    out.set(sale.userId, t);
  }
  return out;
}

/** Sales by day and kind, every day of `days` present (a quiet day is a zero bar, not a gap). */
function dailyOf(sales: LedgerSale[], days: SalaryDayKey[]): ChatterDailyPoint[] {
  const byDay = new Map<string, { ppv: number; tips: number }>(days.map(d => [d, { ppv: 0, tips: 0 }]));
  for (const sale of sales) {
    const d = byDay.get(sale.day);
    if (!d) continue;
    if (sale.kind === 'ppv') d.ppv += sale.gross;
    else d.tips += sale.gross;
  }
  return [...byDay].map(([day, v]) => ({ day, ppvGross: round2(v.ppv), tipsGross: round2(v.tips) }));
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

/** A whole calendar month, `delta` months from the current one. */
function wholeMonth(month: string, delta: number) {
  const m = addMonths(month, delta);
  return { from: `${m}-01`, to: `${m}-${String(daysInMonth(m)).padStart(2, '0')}` };
}

/** `months` back to the day, through today: 12 Oct → 13 Jul … 12 Oct for 3 (a short month clamps). */
function rollingMonths(today: SalaryDayKey, months: number) {
  const m = addMonths(today.slice(0, 7), -months);
  const day = Math.min(Number(today.slice(8, 10)), daysInMonth(m));
  return { from: addDays(`${m}-${String(day).padStart(2, '0')}`, 1), to: today };
}

function resolvePeriod(period: ChatterPeriod, from: string | null, to: string | null, now: number) {
  const today = currentDayKey(now);
  const month = currentMonthKey(now);
  switch (period) {
    case 'mtd':
      return { from: `${month}-01`, to: today };
    case 'prev-month':
      return wholeMonth(month, -1);
    case 'month-2':
      return wholeMonth(month, -2);
    // The last 7 complete days, matching the synced `7d` period doc.
    case '7d':
      return { from: addDays(today, -7), to: addDays(today, -1) };
    case '3m':
      return rollingMonths(today, 3);
    case '6m':
      return rollingMonths(today, 6);
    case '12m':
      return rollingMonths(today, 12);
    case '30d':
      return { from: toDayKey(now - 30 * 86_400_000), to: today };
    case 'custom':
      return { from: from!, to: to! };
  }
}

/**
 * The team-wide reads behind Chatter Analytics, cached once per period and
 * projected per viewer — an agent, an admin and an admin's per-chatter report
 * all share them.
 */
async function loadChatterTeam(period: ChatterPeriod, range: { from: string; to: string }) {
  const key = `chatters:${period}:${range.from}:${range.to}`;
  const activityFrom = BUDDYX_TEAM_STATS_START_DAY;
  const hasActivityWindow = range.to >= activityFrom;
  return cached(key, async () => {
    // BuddyX only holds activity from its start day; asking for earlier days is
    // a read that can only miss.
    const days = hasActivityWindow ? enumerateDays(range.from > activityFrom ? range.from : activityFrom, range.to) : [];
    // Only the synced presets have a doc of their own; every other range finds
    // its medians in the doc an admin's Pull writes for exactly those days.
    const periodId = (TEAM_PERIODS as readonly string[]).includes(period) ? period : `custom-${range.from}-${range.to}`;
    const [daySnaps, periodSnap, massSnap, sales] = await Promise.all([
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
      readSales(range.from, range.to),
    ]);
    const dayDocs = daySnaps.filter(s => s.exists).map(s => s.data() as BuddyxTeamDayDocument);
    const periodDoc = periodSnap?.exists ? (periodSnap.data() as BuddyxTeamPeriodDocument) : null;

    // Whole-period rows when we have them (exact medians); otherwise summed days.
    const rows = periodDoc?.breakdown ?? dayDocs.flatMap(d => d.breakdown ?? []);
    return {
      rows,
      grouped: groupRows(rows),
      hasMedians: Boolean(periodDoc),
      sales,
      ledger: foldLedger(sales),
      mass: (massSnap?.docs ?? []).map(d => d.data() as BuddyxMassMessageDocument),
    };
  });
}

/**
 * The period the board compares against. A month-shaped period compares with
 * the month before (month to date with the same days of last month); every
 * other period with the same number of days immediately before it. None past
 * `BOARD_RATE_MAX_DAYS`, and none reaching before the sales history starts —
 * against an empty period every change reads as infinite growth.
 */
function comparisonRange(period: ChatterPeriod, range: { from: string; to: string }): { from: string; to: string } | null {
  const length = enumerateDays(range.from, range.to).length;
  if (length > BOARD_RATE_MAX_DAYS) return null;
  let prev: { from: string; to: string };
  if (period === 'prev-month' || period === 'month-2') {
    prev = wholeMonth(range.from.slice(0, 7), -1);
  } else if (period === 'mtd') {
    const m = addMonths(range.from.slice(0, 7), -1);
    const lastDay = Math.min(Number(range.to.slice(8, 10)), daysInMonth(m));
    prev = { from: `${m}-01`, to: `${m}-${String(lastDay).padStart(2, '0')}` };
  } else {
    prev = { from: addDays(range.from, -length), to: addDays(range.from, -1) };
  }
  return prev.from >= CREATOR_HISTORY_START_DAY ? prev : null;
}

type ChatterTeam = Awaited<ReturnType<typeof loadChatterTeam>>;

/**
 * The sales board — one row per agent, ranked by gross — plus the team's
 * totals. Identical for every viewer, so it is built once per period and
 * cached; an agent's request and an admin's share it.
 *
 * Rows: every agent who held a sale, had BuddyX activity, or was rostered (a
 * rostered agent who sold nothing is a $0 row, not a missing one). Archived
 * agents are left out (rule 6); their sales still count in the team total,
 * which is the team's money, not the board's sum.
 */
async function loadBoard(period: ChatterPeriod, range: { from: string; to: string }, team: ChatterTeam, now: number) {
  return cached(`board:${period}:${range.from}:${range.to}`, async () => {
    const [start] = dayKeyRange(range.from);
    const [, end] = dayKeyRange(range.to);
    const windowEnd = Math.min(end, now);
    const prevRange = comparisonRange(period, range);
    // Per-hour rates need every agent's time ledger over the period, a read
    // that grows with the range — so, like the comparison, only up to a quarter.
    const withRates = enumerateDays(range.from, range.to).length <= BOARD_RATE_MAX_DAYS;

    const linkedUids = [...team.grouped.keys()].filter(k => !k.startsWith('chatter:'));
    const roster = await rosterForWindow(start, windowEnd);
    const candidates = [...new Set([...linkedUids, ...team.ledger.keys(), ...roster.keys()])];
    const [labels, timeLedger, active, prevSales] = await Promise.all([
      userLabelsFor(candidates),
      withRates ? getLedgerEntriesForUsers(candidates, start - LEDGER_LOOKBACK_MS, windowEnd) : Promise.resolve(null),
      withRates ? getActiveSessionsForUsers(candidates) : Promise.resolve(null),
      prevRange ? readSales(prevRange.from, prevRange.to) : Promise.resolve(null),
    ]);
    const prevLedger = prevSales ? foldLedger(prevSales) : null;

    const rows: SalesBoardRow[] = candidates
      .filter(uid => labels.get(uid)?.isArchived !== true)
      .map(uid => {
        const ledger = team.ledger.get(uid);
        const label = labels.get(uid);
        const ppvGross = round2(ledger?.ppvGross ?? 0);
        const tipsGross = round2(ledger?.tipsGross ?? 0);
        const clockedMs = timeLedger && active ? computeTimeWorked(start, windowEnd, timeLedger.get(uid) ?? [], active.get(uid)) * 1000 : null;
        const prev = prevLedger?.get(uid);
        return {
          uid,
          name: label?.displayName ?? team.grouped.get(uid)?.[0]?.chatterName ?? uid,
          photoURL: label?.photoURL ?? null,
          ppvGross,
          tipsGross,
          ppvSales: ledger?.ppvSales ?? 0,
          tipsCount: ledger?.tipsCount ?? 0,
          clockedMs,
          grossPerHour: clockedMs !== null && clockedMs >= 3_600_000 ? round2((ppvGross + tipsGross) / (clockedMs / 3_600_000)) : null,
          accounts: roster.get(uid)?.accounts.size ?? 0,
          prevGross: prevLedger ? round2((prev?.ppvGross ?? 0) + (prev?.tipsGross ?? 0)) : null,
        };
      });
    rows.sort(byGross);

    // A BuddyX chatter mapped to nobody: its revenue is BuddyX's own (it holds
    // no ledger sale). Admin only — the route never sends these to an agent.
    const unlinked: SalesBoardRow[] = [...team.grouped.entries()]
      .filter(([k]) => k.startsWith('chatter:'))
      .map(([, bxRows]) => {
        const m = metricsFrom(bxRows, undefined, false);
        const chatter = bxRows[0];
        return {
          uid: null,
          name: `${chatter?.chatterName ?? `Chatter ${chatter?.chatterId}`} (not linked)`,
          photoURL: null,
          ppvGross: m.ppvGross,
          tipsGross: m.tipsGross,
          ppvSales: m.ppvSales,
          tipsCount: m.tipsCount,
          clockedMs: null,
          grossPerHour: null,
          accounts: 0,
          prevGross: null,
        };
      })
      .filter(r => r.ppvGross + r.tipsGross !== 0)
      .sort(byGross);

    let ppvGross = 0;
    let tipsGross = 0;
    for (const t of team.ledger.values()) {
      ppvGross += t.ppvGross;
      tipsGross += t.tipsGross;
    }
    const teamSales: TeamSales = {
      ppvGross: round2(ppvGross),
      tipsGross: round2(tipsGross),
      prev: prevRange && prevSales ? { ...prevRange, gross: round2(prevSales.reduce((s, x) => s + x.gross, 0)) } : null,
      daily: dailyOf(team.sales, enumerateDays(range.from, range.to)),
    };
    return { rows, unlinked, roster, team: teamSales };
  });
}

/** Gross, then sales made, then name — so a tie still reads in a stable order. */
function byGross(a: SalesBoardRow, b: SalesBoardRow): number {
  return (
    b.ppvGross + b.tipsGross - (a.ppvGross + a.tipsGross) ||
    b.ppvSales + b.tipsCount - (a.ppvSales + a.tipsCount) ||
    a.name.localeCompare(b.name)
  );
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
  const activityFrom = BUDDYX_TEAM_STATS_START_DAY;
  const hasActivityWindow = range.to >= activityFrom;

  const team = await loadChatterTeam(params.period, range);
  const board = await loadBoard(params.period, range, team, now);
  const metricsFor = (uid: string) => metricsFrom(team.grouped.get(uid) ?? [], team.ledger.get(uid), team.hasMedians);
  const hasData = (uid: string) => team.ledger.has(uid) || team.grouped.has(uid);
  const me = hasData(params.viewerUid) ? metricsFor(params.viewerUid) : null;

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
    isAdmin: params.isAdmin,
    me,
    daily,
    mass: massSummary(team.mass.filter(m => m.uid === params.viewerUid)),
    // The named board goes to everyone, as sales only (`SalesBoardRow`).
    // Unlinked BuddyX chatters are an admin's mapping problem, not a colleague.
    board: params.isAdmin ? [...board.rows, ...board.unlinked] : board.rows,
    team: board.team,
    flags: null,
  };
  if (!params.isAdmin) return result;

  // ── Admin: the integrity flags ──
  // "Never online" only means anything where BuddyX could have seen the agent,
  // so its roster is the part of the range BuddyX covers.
  const [start] = dayKeyRange(range.from);
  const [, end] = dayKeyRange(range.to);
  const windowEnd = Math.min(end, now);
  const activityStart = Math.max(start, dayKeyRange(activityFrom)[0]);
  const [activityRoster, integrityDays] = await Promise.all([
    hasActivityWindow && activityStart > start ? rosterForWindow(activityStart, windowEnd) : Promise.resolve(null),
    cached(`integrity:${range.from}:${range.to}`, () => getIntegrityDays(range.from, range.to)),
  ]);
  const offlineRoster = hasActivityWindow ? activityRoster ?? board.roster : new Map<string, { accounts: Set<string>; shifts: number }>();

  result.flags = sortFlags(
    board.rows.flatMap(row =>
      row.uid
        ? flagsForAgent({
            uid: row.uid,
            name: row.name,
            onlineMs: metricsFor(row.uid).onlineMs,
            rosteredShifts: offlineRoster.get(row.uid)?.shifts ?? 0,
            integrityDays: integrityDays.get(row.uid),
          })
        : [],
    ),
  );
  return result;
}

/**
 * One agent's report (admin only — the route enforces it): sales first — by
 * day, by account, by shift, and their place on the board — then the flags
 * they earn and every shift. Reuses the team and board caches, so opening a
 * report from the page costs only this agent's own reads (time ledger,
 * captures, shifts, integrity days) and the hourly BuddyX docs.
 */
export async function getChatterReport(params: {
  uid: string;
  period: ChatterPeriod;
  from: string | null;
  to: string | null;
  now?: number;
}): Promise<ChatterReport> {
  const now = params.now ?? Date.now();
  const range = resolvePeriod(params.period, params.from, params.to, now);
  const team = await loadChatterTeam(params.period, range);
  const allDays = enumerateDays(range.from, range.to);
  const activityDays =
    range.to >= BUDDYX_TEAM_STATS_START_DAY
      ? enumerateDays(range.from > BUDDYX_TEAM_STATS_START_DAY ? range.from : BUDDYX_TEAM_STATS_START_DAY, range.to)
      : [];
  const [user, reads, integrityDays, hoursDocs, board] = await Promise.all([
    getUserById(params.uid),
    reportReads(params.uid, allDays, now),
    getIntegrityDays(range.from, range.to, params.uid),
    // Hourly messages for the shift table; cached so paging between agents is free.
    cached(`hours:${activityDays[0] ?? ''}:${range.to}`, () => readTeamHours(activityDays)),
    loadBoard(params.period, range, team, now),
  ]);
  const name = user?.displayName || params.uid;
  const ledger = team.ledger.get(params.uid);
  const bxRows = team.grouped.get(params.uid) ?? [];
  const metrics = ledger || bxRows.length ? metricsFrom(bxRows, ledger, team.hasMedians) : null;
  const mySales = team.sales.filter(x => x.userId === params.uid);

  const byAccount = new Map<string, ReportAccount>();
  for (const sale of mySales) {
    const key = sale.accountKey || 'unknown';
    const a = byAccount.get(key) ?? { key, name: sale.accountName || 'Unknown account', gross: 0, sales: 0 };
    a.gross += sale.gross;
    a.sales += 1;
    byAccount.set(key, a);
  }

  const shifts = await reportShifts({
    uid: params.uid,
    start: reads.start,
    end: reads.end,
    now,
    entries: reads.entries,
    active: reads.active,
    hoursDocs,
    captures: reads.captures,
    sales: mySales.map(x => ({ at: x.at, gross: x.gross })),
  });
  const scheduledInActivity = shifts.filter(s => s.scheduled && toDayKey(s.startMs) >= BUDDYX_TEAM_STATS_START_DAY).length;
  const position = board.rows.findIndex(r => r.uid === params.uid);

  return {
    uid: params.uid,
    name,
    period: params.period,
    from: range.from,
    to: range.to,
    metrics,
    clockedMs: computeTimeWorked(reads.start, reads.end, reads.entries, reads.active) * 1000,
    rank: position >= 0 ? { position: position + 1, of: board.rows.length } : null,
    integrity: summariseIntegrity(integrityDays.get(params.uid)),
    flags: sortFlags(
      flagsForAgent({
        uid: params.uid,
        name,
        onlineMs: metrics?.onlineMs ?? null,
        rosteredShifts: scheduledInActivity,
        integrityDays: integrityDays.get(params.uid),
      }),
    ),
    shifts,
    daily: dailyOf(mySales, allDays),
    accounts: [...byAccount.values()]
      .map(a => ({ ...a, gross: round2(a.gross) }))
      .sort((a, b) => b.gross - a.gross),
    inputMonitoring: user?.inputMonitoring === true,
  };
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

/**
 * A rollup's name through the one resolution order (`resolveFanName`): the
 * registry's manual/customs name (written through as `displayName`), then the
 * synced name, then the name on the fan's latest sale.
 */
function fanNameOf(doc: BuddyxFanDocument): { name: string | null; nameSource: FanSummary['nameSource'] } {
  const { name, source } = resolveFanName({
    manualName: doc.displayNameSource === 'manual' ? doc.displayName : null,
    customsName: doc.displayNameSource === 'customs' ? doc.displayName : null,
    name: doc.name || doc.salesName || null,
    source: doc.name ? doc.nameSource : 'buddyx-link',
  });
  return { name, nameSource: source };
}

export function summariseFan(doc: BuddyxFanDocument, months: string[] | null): FanSummary {
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
    // A name set by hand or taken from customs is written through by the fan
    // registry; the synced name is the fallback (fanIdentity.resolveFanName).
    ...fanNameOf(doc),
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

/**
 * Every `buddyx-fans` row for a set of creators, cached 60s per scope — the
 * Fan Analytics insights and the fan directory read the same rows.
 */
export async function readFans(creatorIds: string[]): Promise<BuddyxFanDocument[]> {
  return cached(`fan-docs:${[...creatorIds].sort().join(',')}`, async () => {
    const chunks: string[][] = [];
    for (let i = 0; i < creatorIds.length; i += 30) chunks.push(creatorIds.slice(i, i + 30));
    const snaps = await Promise.all(chunks.map(ids =>
      adminDb
        .collection('buddyx-fans')
        .where('creatorId', 'in', ids)
        .select('creatorId', 'fanId', 'name', 'nameSource', 'salesName', 'displayName', 'displayNameSource', 'spendByMonth', 'acquisition', 'subscriptions', 'isStacker', 'linkTotalSpent')
        .get(),
    ));
    return snaps.flatMap(snap => snap.docs.map(doc => doc.data() as BuddyxFanDocument));
  });
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

interface ModelEntry { modelId: string; creatorId: string | null; name: string | null }

/** The BuddyX model directory, field-masked. Small, and changes a few times a year. */
async function readModelDirectory(): Promise<ModelEntry[]> {
  return cached('models:directory', async () => {
    const snap = await adminDb.collection('buddyx-models').select('handle', 'customName', 'creatorId').get();
    return snap.docs.map(d => {
      const handle = d.get('handle') as string | null | undefined;
      return {
        modelId: d.id,
        creatorId: (d.get('creatorId') as string | null | undefined) ?? null,
        name: (d.get('customName') as string | null | undefined) || (handle ? `@${handle}` : null),
      };
    });
  });
}

interface AccountEntry { name: string; archived: boolean; photoThumb: string | null }

/**
 * Every creator and sub-account, **archived included** — history must still
 * name them. Two field-masked reads, cached; never one read per creator (rule 9).
 */
async function readCreatorAccounts(): Promise<Map<string, AccountEntry>> {
  return cached('creator-accounts', async () => {
    const [creatorSnap, subSnap] = await Promise.all([
      adminDb.collection('creators').select('stageName', 'isArchived', 'photoThumb').get(),
      adminDb.collection('creator-subaccounts').select('stageName', 'label', 'parentCreatorId', 'isArchived', 'photoThumb').get(),
    ]);
    const accounts = new Map<string, AccountEntry>();
    for (const d of creatorSnap.docs) {
      accounts.set(d.id, {
        name: (d.get('stageName') as string | undefined) || d.id,
        archived: d.get('isArchived') === true,
        photoThumb: (d.get('photoThumb') as string | null | undefined) ?? null,
      });
    }
    for (const d of subSnap.docs) {
      const parent = accounts.get(d.get('parentCreatorId') as string);
      const label = d.get('label') as string | undefined;
      accounts.set(d.id, {
        name: (d.get('stageName') as string | undefined) || (parent ? `${parent.name}${label ? ` (${label})` : ''}` : d.id),
        archived: d.get('isArchived') === true || !parent || parent.archived,
        photoThumb: (d.get('photoThumb') as string | null | undefined) ?? parent?.photoThumb ?? null,
      });
    }
    return accounts;
  });
}

/**
 * Rows stored under an unmapped model's key (`buddyx:{modelId}`) are folded into
 * the creator once that model is mapped, so mapping late never splits a
 * creator's history across two cards. A real row for the same day wins.
 */
function foldUnmappedDays(rows: CreatorStatsDayDocument[], modelCreator: Map<string, string>): CreatorStatsDayDocument[] {
  if (!rows.some(r => modelIdOfUnmappedKey(r.creatorId))) return rows;
  const real = new Set(rows.filter(r => !modelIdOfUnmappedKey(r.creatorId)).map(r => `${r.creatorId}_${r.day}`));
  const out: CreatorStatsDayDocument[] = [];
  for (const r of rows) {
    const modelId = modelIdOfUnmappedKey(r.creatorId);
    const mapped = modelId ? modelCreator.get(modelId) : undefined;
    if (!mapped) out.push(r);
    else if (!real.has(`${mapped}_${r.day}`)) out.push({ ...r, creatorId: mapped });
  }
  return out;
}

export async function getCreatorAnalytics(params: { from: string; to: string; creatorId: string | null }): Promise<CreatorAnalytics> {
  const { from, to, creatorId } = params;
  const span = enumerateDays(from, to).length;
  const prevFrom = addDays(from, -span);
  const prevTo = addDays(from, -1);

  const [rawRangeDays, rawPrevDays, linkSnap, massSnap, subsSnap, models, accounts] = await Promise.all([
    readCreatorDays(from, to),
    readCreatorDays(prevFrom, prevTo),
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
        .select('modelId', 'creatorId', 'subType', 'isTrial', 'isCreator', 'day')
        .get()
        .then(s => s.docs.map(d => d.data() as { modelId: string | null; creatorId: string | null; subType: string | null; isTrial: boolean; isCreator: boolean; day: string })),
    ),
    readModelDirectory(),
    readCreatorAccounts(),
  ]);

  const modelCreator = new Map(models.flatMap(m => (m.creatorId ? [[m.modelId, m.creatorId] as const] : [])));
  const modelName = new Map(models.map(m => [m.modelId, m.name]));
  const mappedIds = new Set(modelCreator.values());
  const rangeDays = foldUnmappedDays(rawRangeDays, modelCreator);
  const prevDays = foldUnmappedDays(rawPrevDays, modelCreator);

  /** The account a BuddyX-side row belongs to — an unmapped model keeps its own key. */
  const keyOf = (r: { creatorId: string | null; modelId?: string | null }): string | null =>
    (r.modelId ? modelCreator.get(r.modelId) : undefined) ?? r.creatorId ?? (r.modelId ? unmappedModelKey(r.modelId) : null);
  const scoped = <T extends { creatorId: string | null; modelId?: string | null }>(rows: T[]) => (creatorId ? rows.filter(r => keyOf(r) === creatorId) : rows);

  const identityOf = (key: string): CreatorIdentity => {
    const modelId = modelIdOfUnmappedKey(key);
    if (modelId) return { name: modelName.get(modelId) ?? `BuddyX creator ${modelId}`, status: 'unmapped', photoThumb: null };
    const account = accounts.get(key);
    if (account) return { name: account.name, status: account.archived ? 'archived' : 'active', photoThumb: account.archived ? account.photoThumb : null };
    const viaModel = models.find(m => m.creatorId === key)?.name;
    return { name: viaModel ?? 'Deleted creator', status: 'missing', photoThumb: null };
  };
  const identities: Record<string, CreatorIdentity> = {};
  const identify = (key: string | null) => {
    if (key && !identities[key]) identities[key] = identityOf(key);
  };

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
  })
    // An archived, deleted or unmapped account earns nothing going forward, so it
    // shows only for a period it actually earned in. Active mapped creators
    // always show — the roster is the selector.
    .filter(card => card.totalGross > 0 || identityOf(card.creatorId).status === 'active')
    .sort((a, b) => b.totalGross - a.totalGross);
  for (const card of roster) identify(card.creatorId);

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
        creatorId: keyOf(l),
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

  // The link that brought in the most revenue *inside the period*. A link's
  // series is cumulative, so the period's figure is the last value at or before
  // `to` minus the last value before `from`; a link first synced inside the
  // period has no baseline and counts from its first entry, as its sparkline does.
  const topLink = linkSnap
    .map(l => {
      const series = Object.entries(l.series ?? {}).sort(([a], [b]) => a.localeCompare(b));
      const inRange = series.filter(([day]) => day >= from && day <= to);
      if (inRange.length === 0) return null;
      const base = series.filter(([day]) => day < from).at(-1)?.[1] ?? inRange[0][1];
      const end = inRange[inRange.length - 1][1];
      return {
        name: l.name,
        creatorId: keyOf(l),
        revenue: round2(Math.max(0, end.revenue - base.revenue)),
        subs: Math.max(0, end.subs - base.subs),
      };
    })
    .filter((l): l is NonNullable<typeof l> => l !== null && l.revenue > 0)
    .sort((a, b) => b.revenue - a.revenue)[0] ?? null;
  for (const l of links.slice(0, 60)) identify(l.creatorId);
  identify(topLink?.creatorId ?? null);
  identify(creatorId);

  // ── Mass messages ──
  const mass = scoped(massSnap).filter(m => m.sentDate);
  const priced = mass.filter(m => m.price > 0);

  // ── Messaging & rev share ──
  const sumSel = (k: keyof CreatorStatsDayDocument) => selected.reduce((s, d) => s + (Number(d[k]) || 0), 0);
  const replies = selected.filter(d => d.source === 'buddyx' && d.replyTimeMs !== null).map(d => d.replyTimeMs as number).sort((a, b) => a - b);
  const revShareRows = selected.filter(d => typeof d.revShareGross === 'number');

  const total = roster.reduce((s, r) => s + r.totalGross, 0);
  const earning = roster.filter(r => r.totalGross > 0);
  const newSubs = rangeDays.reduce((s, d) => s + (d.newSubs ?? 0), 0);
  // No rows at all in the previous window means it predates the history, not
  // that it earned nothing — say "—", not "+100%".
  const hasPrevious = prevDays.length > 0;

  return {
    from,
    to,
    creatorId,
    cutoverDay: BUDDYX_CREATOR_STATS_START_DAY,
    kpis: {
      earnings: round2(total),
      previousEarnings: hasPrevious ? round2(prevDays.reduce((s, d) => s + (d.totalGross ?? 0), 0)) : null,
      newSubs,
      previousNewSubs: hasPrevious ? prevDays.reduce((s, d) => s + (d.newSubs ?? 0), 0) : null,
      topLink,
      earningCreators: earning.length,
      topCreator: earning[0] ? { creatorId: earning[0].creatorId, gross: earning[0].totalGross, share: total > 0 ? Math.round((earning[0].totalGross / total) * 1000) / 1000 : 0 } : null,
      // Legacy keys for renderers loaded before the tiles followed the period
      // (rule 9c). They now carry the period's figures; drop them once stale
      // clients have cycled.
      earningsMtd: round2(total),
      newSubsMtd: newSubs,
      bestLink: null,
      activeCreators: earning.length,
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
    identities,
  };
}
