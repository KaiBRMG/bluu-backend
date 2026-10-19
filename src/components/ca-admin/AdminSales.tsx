'use client';

import { usePermissions } from '@/hooks/usePermissions';
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, ChevronDown, Loader2Icon, RotateCcw, Search, X } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { SELECT_BOX_CLASS, SURFACE } from '@/lib/surfaces';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from '@/components/ui/select';
import { EllipsisPagination } from '@/components/EllipsisPagination';
import { useAuth } from '@/components/AuthProvider';
import { useAuthFetch } from '@/hooks/useAuthFetch';
import { useUserData } from '@/hooks/useUserData';
import { activeChatAgents, useBasicUsers } from '@/hooks/useBasicUsers';
import { SALARY_HISTORY_START_MONTH } from '@/lib/salary/salaryConstants';
import { addDays, addMonths, currentDayKey, enumerateDays, formatDayLabel, formatMonthName } from '@/lib/salary/salaryDate';
import { SyncStatus } from '@/components/buddyx/SyncStatus';
import { PeriodPicker, dayKeyToDate } from '@/components/buddyx/PeriodPicker';
import { CreatorCombobox } from '@/components/buddyx/CreatorCombobox';
import { AttrChip, FanLabel, InfoTip, LEDGER_PPV_ATTRIBUTION, SEGMENT, LEDGER_TIPS_ATTRIBUTION } from '@/components/buddyx/buddyxUi';
import { CreatorChip } from '@/components/creators/CreatorChip';
import { PersonTag } from '@/components/disputes/disputeUi';
import { buddyxCreditName, holderName, SaleHolderNote } from '@/components/salary/SaleHolderNote';
import { reassignRefusal } from '@/lib/disputes/disputeRules';
import { round2 } from '@/lib/salary/salaryEngine';
import { DEFAULT_DEDUCTION_RATE } from '@/lib/salary/salaryConstants';
import { getCache, setCache } from '@/lib/queryCache';
import { formatSaleDateTime, formatUsd, pluralise, signedMoneyClass } from '@/lib/salary/salaryFormat';
import { saleTypeLabel } from '@/lib/salary/saleTypes';
import type { SalarySale } from '@/lib/salary/salaryTypes';
import type { ScheduleMatch } from '@/lib/salary/scheduleMatch';
import { format } from 'date-fns';
import type { DisputeDocument } from '@/types/firestore';
import type { SaleDisputeMark, SaleDisputeOutcome } from '@/lib/disputes/disputeRules';
import { PILL_CLASS } from '@/components/disputes/disputeUi';
import { useDisputesData } from '@/hooks/useDisputesData';
import { DisputeDetailDialog } from '@/components/disputes/DisputeDetailDialog';
import { disputeStage, formatMoney, OUTCOME_LABEL, outcomePillClass, verdictToast } from '@/components/disputes/disputeStatus';
import { DisputeMovesFeed } from './DisputeMovesFeed';

/**
 * CA Admin → Sales — every sale in a period, for the whole roster, newest
 * first: assigned and unassigned, on every creator.
 *
 * A CA manager keeps the ledger trustworthy and answers "where did this
 * agent's money come from". So: the **attention band** first — every anomaly
 * the ledger can detect, each line naming its rows and offering a way to them
 * — then **the ledger**, paged, where any BuddyX sale can be assigned or
 * reassigned from its row or in bulk from a selection — BuddyX and Infloww
 * history alike. The identity mapping
 * sits collapsed underneath.
 *
 * **Off schedule** is the anomaly this page leads with: a sale held by someone
 * other than the agent the shift schedule put on that creator account at that
 * moment (`scheduleMatch.ts`). Each such row carries its own fix — *Move to
 * {agent on shift}* — one click, with Undo; the selection bar does the same for
 * a whole page.
 *
 * **Bluu Backend is the source of truth for sales.** Each row shows who holds
 * it here *and* who BuddyX credits, with a `SaleHolderNote` wherever the two
 * differ and why (an approved dispute, or an admin). Every later sync keeps a move.
 *
 * **Disputes live here too** (2026-10-19; there is no Disputes tab any more).
 * A dispute needs one approval — the agent holding the sale — and moves the
 * sale the moment it is given, so the admin's job is oversight, not a queue:
 * - **Moved by dispute** leads the tab (`DisputeMovesFeed`): every claim
 *   approved in the last 14 days, whatever the period below, each with
 *   *Overturn*.
 * - **The attention band** names any claim only an admin can rule on — a sale
 *   nobody holds — with *Review*.
 * - **The Disputed view** is the archive: every sale in the period a dispute
 *   ever claimed, with its outcome (`disputes`, joined server-side), opening
 *   the claim behind it.
 *
 * The server sends the whole period at once (≤ 93 days) and the page filters
 * and pages it in memory, so paging costs no Firestore reads (rule 9).
 */

const CACHE_TTL_MS = 60_000;
const PAGE_SIZE = 50;
const MAX_DAYS = 93;
/** The reason recorded when a sale is moved onto the shift schedule's agent. */
const SCHEDULE_REASON = 'Matched to the shift schedule — on shift for this account at the time of sale';

interface AllSalesResponse {
  from: string;
  to: string;
  sales: SalarySale[];
  names: Record<string, string>;
  deductionRate: number;
  totals: { gross: number; count: number; reversals: number };
  unassigned: { tips: number; tipsGross: number; ppv: number; ppvGross: number; unmapped: number; claimed: number };
  mismatched: { dispute: number; admin: number; gross: number };
  schedule: Record<string, ScheduleMatch>;
  /** Only the sales a dispute ever claimed: the latest claim and what it did here. */
  disputes: Record<string, SaleDisputeMark>;
  flags: {
    attributionConflicts: string[];
    vanishedAfterFinalise: string[];
    removed: number;
    offSchedule: string[];
    staleLocks: string[];
    possibleDuplicates: string[];
    zeroGross: string[];
    archivedHolders: Array<{ uid: string; gross: number; count: number }>;
  };
  spansCutover: boolean;
}

/** An attention line's "Show them": the ledger narrowed to exactly those rows. */
interface Focus {
  label: string;
  ids: Set<string>;
}

interface MappingResponse {
  chatters: Array<{
    chatterId: string;
    name: string | null;
    email: string | null;
    status: string | null;
    uid: string | null;
    displayName: string | null;
    match: 'email' | 'manual' | 'none';
  }>;
  models: Array<{
    modelId: string;
    handle: string | null;
    customName: string | null;
    creatorId: string | null;
    creatorName: string | null;
    match: 'handle' | 'manual' | 'none';
  }>;
}

/** Only what the attention band reads from the last sync. */
interface SyncRun {
  scopes: string[];
  counts: Record<string, number>;
  dryRun: boolean;
}

type KindFilter = 'all' | 'tip' | 'ppv';
export type SalesView = 'all' | 'unassigned' | 'off-schedule' | 'differs' | 'disputed' | 'removed';
type OutcomeFilter = SaleDisputeOutcome | 'all';
type Period = 'today' | '7d' | 'month' | 'last-month';

const VIEWS: Array<{ value: SalesView; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'unassigned', label: 'Unassigned' },
  { value: 'off-schedule', label: 'Off schedule' },
  { value: 'differs', label: 'Differs from BuddyX' },
  { value: 'disputed', label: 'Disputed' },
  { value: 'removed', label: 'Removed' },
];

/** The Disputed view's outcome filter, in the order a reader scans for trouble. */
const OUTCOMES: SaleDisputeOutcome[] = ['moved', 'open', 'skipped', 'declined', 'overturned', 'reverted', 'rejected'];

function inView(
  s: SalarySale,
  view: SalesView,
  schedule: Record<string, ScheduleMatch>,
  disputes: Record<string, SaleDisputeMark>,
): boolean {
  switch (view) {
    case 'all':
      return !s.removedAt;
    case 'unassigned':
      return !s.removedAt && !s.userId;
    case 'off-schedule':
      return schedule[s.saleId]?.offSchedule === true;
    case 'differs':
      // Moved by a dispute or an admin, or credited to the agent on shift rather than BuddyX's chatter.
      return !s.removedAt && (!s.matchesSource || Boolean(s.transfer) || s.buddyxUserId !== s.userId);
    case 'disputed':
      // Removed rows included: a dispute's outcome is history worth keeping.
      return Boolean(disputes[s.saleId]);
    case 'removed':
      return Boolean(s.removedAt);
  }
}

/** Salary days, so a preset agrees with payroll whatever zone the reader is in. */
function presetRange(period: Period): { from: string; to: string } {
  const today = currentDayKey();
  const month = today.slice(0, 7);
  switch (period) {
    case 'today':
      return { from: today, to: today };
    case '7d':
      return { from: addDays(today, -6), to: today };
    case 'month':
      return { from: `${month}-01`, to: today };
    case 'last-month':
      return { from: `${addMonths(month, -1)}-01`, to: addDays(`${month}-01`, -1) };
  }
}

/** The one agent the schedule had on this sale's account, when moving it there is a single, unambiguous fix. */
function scheduleTarget(sale: SalarySale, schedule: Record<string, ScheduleMatch>): string | null {
  const match = schedule[sale.saleId];
  if (!match?.offSchedule || match.scheduled.length !== 1) return null;
  return match.scheduled[0] === sale.userId ? null : match.scheduled[0];
}

/** Whether a row can be moved here at all — the client half of `reassignRefusal`; the server re-checks. */
function movable(sale: SalarySale, staleLocks: Set<string>): boolean {
  return !sale.removedAt && (!sale.disputeId || staleLocks.has(sale.saleId));
}

export default function AdminSales({ timezone, initialView = 'all' }: { timezone: string; initialView?: SalesView }) {
  const { user } = useAuth();
  const { userData } = useUserData();
  const isAdmin = userData?.groups?.includes('admin') === true || userData?.role === 'admin';
  const fanReports = usePermissions().canAccess('/ca-portal/fan-analytics');
  const authed = useAuthFetch();

  // ── Period ──
  const [period, setPeriod] = useState<Period | 'custom'>('month');
  const [customFrom, setCustomFrom] = useState<Date | undefined>(undefined);
  const [customTo, setCustomTo] = useState<Date | undefined>(undefined);
  const range = useMemo(() => {
    if (period !== 'custom') return presetRange(period);
    return {
      from: customFrom ? format(customFrom, 'yyyy-MM-dd') : null,
      to: customTo ? format(customTo, 'yyyy-MM-dd') : null,
    };
  }, [period, customFrom, customTo]);
  const rangeProblem =
    !range.from || !range.to
      ? 'Pick a start and an end date.'
      : range.from > range.to
        ? 'The end date must be on or after the start date.'
        : enumerateDays(range.from, range.to).length > MAX_DAYS
          ? `Pick at most ${MAX_DAYS} days at a time.`
          : range.to < `${SALARY_HISTORY_START_MONTH}-01`
            ? 'Salary history starts in September 2026.'
            : null;

  const [data, setData] = useState<AllSalesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mapping, setMapping] = useState<MappingResponse | null>(null);
  const [mappingOpen, setMappingOpen] = useState(false);
  const [lastRun, setLastRun] = useState<SyncRun | null>(null);

  // ── Filters ──
  // Derived, not copied into state: the page reads `?tab=disputes` after its
  // first render (an external store with no server value), so a late
  // `initialView` must still land until the reader picks a view themselves.
  const [pickedView, setView] = useState<SalesView | null>(null);
  const view = pickedView ?? initialView;
  const [outcome, setOutcome] = useState<OutcomeFilter>('all');
  const [agent, setAgent] = useState('all');
  const [creatorId, setCreatorId] = useState<string | null>(null);
  const [kind, setKind] = useState<KindFilter>('all');
  const [focus, setFocus] = useState<Focus | null>(null);
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [page, setPage] = useState(1);
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [reassigning, setReassigning] = useState<SalarySale | null>(null);
  const [moving, setMoving] = useState<string | null>(null);
  const ledgerTop = useRef<HTMLDivElement>(null);

  const load = useCallback(
    async (force = false) => {
      if (!user || rangeProblem || !range.from || !range.to) return;
      const key = `bluu_admin_sales_v2:${user.uid}:${range.from}:${range.to}`;
      if (!force) {
        const cached = getCache<AllSalesResponse>(key, CACHE_TTL_MS);
        if (cached) {
          setData(cached);
          setLoading(false);
          return;
        }
        setData(null);
        setLoading(true);
      }
      setError(null);
      try {
        const body = (await authed(`/api/ca-salary/sales?userId=all&from=${range.from}&to=${range.to}`)) as AllSalesResponse;
        setCache(key, body);
        setData(body);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not load sales');
      } finally {
        setLoading(false);
      }
    },
    [user, range.from, range.to, rangeProblem, authed],
  );

  const loadMapping = useCallback(async () => {
    try {
      setMapping((await authed('/api/admin/buddyx/mapping')) as MappingResponse);
    } catch {
      /* the band falls back to what the ledger alone can say */
    }
  }, [authed]);

  const loadLastRun = useCallback(async () => {
    try {
      const { runs } = (await authed('/api/admin/buddyx/runs')) as { runs: SyncRun[] };
      setLastRun(runs.find(r => r.scopes.includes('sales') && !r.dryRun) ?? null);
    } catch {
      /* the last-sync lines are simply absent */
    }
  }, [authed]);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    void loadMapping();
    void loadLastRun();
  }, [loadMapping, loadLastRun]);

  const schedule = useMemo(() => data?.schedule ?? {}, [data]);
  const disputeMarks = useMemo(() => data?.disputes ?? {}, [data]);
  const staleLocks = useMemo(() => new Set(data?.flags.staleLocks ?? []), [data]);
  const flagged = useMemo(
    () => ({ duplicates: new Set(data?.flags.possibleDuplicates ?? []), zero: new Set(data?.flags.zeroGross ?? []) }),
    [data],
  );

  // Every filter except the view, so each view's count is what clicking it produces.
  const base = useMemo(() => {
    if (!data) return [];
    const needle = deferredQuery.trim().toLowerCase();
    return data.sales.filter(s => {
      if (agent !== 'all' && s.userId !== agent) return false;
      if (creatorId && s.creatorId !== creatorId) return false;
      if (kind !== 'all' && s.kind !== kind) return false;
      if (!needle) return true;
      return (
        s.fanName.toLowerCase().includes(needle) ||
        s.fanId.includes(needle) ||
        s.employeeName.toLowerCase().includes(needle) ||
        (s.userId ? (data.names[s.userId] ?? '').toLowerCase().includes(needle) : false) ||
        s.saleId.toLowerCase().includes(needle)
      );
    });
  }, [data, deferredQuery, agent, creatorId, kind]);

  const viewCounts = useMemo(() => {
    const views = Object.fromEntries(VIEWS.map(v => [v.value, 0])) as Record<SalesView, number>;
    const outcomes = Object.fromEntries(OUTCOMES.map(o => [o, 0])) as Record<SaleDisputeOutcome, number>;
    for (const s of base) {
      for (const v of VIEWS) if (inView(s, v.value, schedule, disputeMarks)) views[v.value] += 1;
      const mark = disputeMarks[s.saleId];
      if (mark) outcomes[mark.outcome] += 1;
    }
    return { views, outcomes };
  }, [base, schedule, disputeMarks]);
  const outcomeCounts = viewCounts.outcomes;

  const filtered = useMemo(() => {
    if (!data) return [];
    if (focus) return data.sales.filter(s => focus.ids.has(s.saleId));
    return base.filter(
      s =>
        inView(s, view, schedule, disputeMarks) &&
        (view !== 'disputed' || outcome === 'all' || disputeMarks[s.saleId]?.outcome === outcome),
    );
  }, [data, base, view, outcome, schedule, disputeMarks, focus]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  // A new listing starts at page one. Selection is derived against the rows on
  // screen, so a page or filter change can never carry an invisible id into
  // the next action (DESIGN.md — the decision queue).
  useEffect(() => {
    setPage(1);
  }, [range.from, range.to, view, outcome, agent, creatorId, kind, deferredQuery, focus]);
  const selected = useMemo(() => pageRows.filter(s => picked.has(s.saleId) && movable(s, staleLocks)), [pageRows, picked, staleLocks]);
  const pageMovable = useMemo(() => pageRows.filter(s => movable(s, staleLocks)), [pageRows, staleLocks]);
  const allPicked = pageMovable.length > 0 && selected.length === pageMovable.length;

  const goToPage = (next: number) => {
    setPage(next);
    const top = ledgerTop.current;
    if (top && top.getBoundingClientRect().top < 0) top.scrollIntoView({ block: 'start' });
  };

  const agents = useMemo(() => {
    if (!data) return [];
    const ids = [...new Set(data.sales.map(s => s.userId).filter((v): v is string => Boolean(v)))];
    return ids.map(uid => ({ uid, name: data.names[uid] ?? uid })).sort((a, b) => a.name.localeCompare(b.name));
  }, [data]);

  const filtersActive =
    focus !== null || view !== 'all' || outcome !== 'all' || agent !== 'all' || creatorId !== null || kind !== 'all' || query.trim() !== '';
  const clearFilters = () => {
    setFocus(null);
    setView('all');
    setOutcome('all');
    setAgent('all');
    setCreatorId(null);
    setKind('all');
    setQuery('');
  };
  const showRows = (label: string, ids: string[]) => {
    clearFilters();
    setFocus({ label, ids: new Set(ids) });
  };
  const showView = (next: SalesView) => {
    clearFilters();
    setView(next);
  };
  // The engine's own formula (`salaryEngine.ts`), at the rate the server sent.
  const net = (gross: number) => round2(gross * (1 - (data?.deductionRate ?? DEFAULT_DEDUCTION_RATE)));
  const nameOf = (uid: string | null) => (data ? holderName(uid, data.names) : '');

  /**
   * Moves through the bulk route — one request for one sale or a hundred, each
   * its own transaction server-side. Refused rows stay selected so the reader
   * can see which ones did not move.
   */
  const move = async (moves: Array<{ saleId: string; toUserId: string | null }>, reason: string) => {
    const result = (await authed('/api/ca-sales/transfer-bulk', {
      method: 'POST',
      body: JSON.stringify({ moves, reason }),
    })) as { moved: string[]; refused: Array<{ saleId: string; error: string }> };
    await load(true);
    return result;
  };

  /** The off-schedule fix: one click onto the scheduled agent, with Undo back to whoever held it. */
  const moveToSchedule = async (sale: SalarySale) => {
    const target = scheduleTarget(sale, schedule);
    if (!target) return;
    const before = sale.userId;
    setMoving(sale.saleId);
    try {
      const { moved, refused } = await move([{ saleId: sale.saleId, toUserId: target }], SCHEDULE_REASON);
      if (refused.length) {
        toast.error(refused[0].error);
        return;
      }
      if (moved.length) {
        toast.success(`${formatUsd(sale.signedGross)} moved to ${nameOf(target)}`, {
          action: {
            label: 'Undo',
            onClick: () => {
              void move([{ saleId: sale.saleId, toUserId: before }], 'Undo — moved onto the shift schedule by mistake')
                .then(r => (r.refused.length ? toast.error(r.refused[0].error) : toast.success(`Back on ${nameOf(before)}`)))
                .catch(err => toast.error(err instanceof Error ? err.message : 'Could not undo'));
            },
          },
        });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not move the sale');
    } finally {
      setMoving(null);
    }
  };

  // ── Disputes ──
  const { fetchDisputes, fetchDispute, setAdminApproval } = useDisputesData();
  /** Bumped after any dispute write, so the feed refetches with the ledger. */
  const [disputeRefresh, setDisputeRefresh] = useState(0);
  /** Bumped only by a ruling — an overturn or un-transfer cannot change what is waiting. */
  const [rulingsRefresh, setRulingsRefresh] = useState(0);
  const [rulings, setRulings] = useState<DisputeDocument[]>([]);
  const [detail, setDetail] = useState<DisputeDocument | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [openingDispute, setOpeningDispute] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchDisputes('admin-ruling')
      .then(r => !cancelled && setRulings(r.disputes))
      .catch(() => {
        /* the band simply lacks the ruling lines; the feed and ledger still load */
      });
    return () => {
      cancelled = true;
    };
  }, [fetchDisputes, rulingsRefresh]);

  const openDetail = useCallback((dispute: DisputeDocument) => {
    setDetail(dispute);
    setDetailOpen(true);
  }, []);

  /** A ledger row carries only its outcome; the claim itself is read on demand. */
  const openClaim = async (disputeId: string) => {
    setOpeningDispute(disputeId);
    try {
      openDetail(await fetchDispute(disputeId));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not open the dispute');
    } finally {
      setOpeningDispute(null);
    }
  };

  const afterDisputeWrite = async () => {
    setDisputeRefresh(k => k + 1);
    await load(true);
  };

  /** Reverse a holder's approval: every moved sale goes back. Reason required. */
  const overturn = async (dispute: DisputeDocument, reason: string) => {
    try {
      await setAdminApproval(dispute.id, 'Rejected', reason);
      const moved = dispute.transferResult?.transferred.length ?? 0;
      toast.success(
        moved > 0
          ? `Overturned · ${pluralise(moved, 'sale')} back with ${dispute.assignedToName || 'the agent the sync credits'}`
          : 'Overturned',
      );
      await afterDisputeWrite();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not overturn the dispute');
      throw err;
    }
  };

  /** An admin's ruling — a claim nobody holds, or in a holder's place. */
  const rule = async (id: string, verdict: 'Approved' | 'Rejected', reason?: string) => {
    try {
      const { transferResult } = await setAdminApproval(id, verdict, reason);
      toast.success(verdictToast(verdict, transferResult));
      setRulingsRefresh(k => k + 1);
      await afterDisputeWrite();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not update the dispute');
      throw err;
    }
  };

  /** Revert one moved sale — the escape hatch for a partly wrong approval. */
  const untransfer = async (saleId: string, reason: string) => {
    try {
      await authed(`/api/ca-sales/${encodeURIComponent(saleId)}/transfer`, {
        method: 'DELETE',
        body: JSON.stringify({ reason }),
      });
      toast.success('Transfer reverted — the sale is back with the agent the sync credits');
      setDetail(prev =>
        prev ? { ...prev, untransfers: [...prev.untransfers, { saleId, by: '', at: new Date().toISOString(), reason }] } : prev,
      );
      await afterDisputeWrite();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not revert the transfer');
      throw err;
    }
  };

  /** The feed's "show them in the ledger": the Disputed view, moved sales, over the same window. */
  const showMovedInLedger = (windowDays: number) => {
    clearFilters();
    setView('disputed');
    setOutcome('moved');
    const today = currentDayKey();
    setPeriod('custom');
    setCustomFrom(dayKeyToDate(addDays(today, -(windowDays - 1))));
    setCustomTo(dayKeyToDate(today));
    requestAnimationFrame(() => ledgerTop.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
  };

  // ── Attention band ──
  const attention = useMemo(() => {
    if (!data) return [];
    const lines: Array<{ key: string; text: string; action?: { label: string; run: () => void } }> = [];
    const live = data.sales.filter(s => !s.removedAt);

    // First: the only disputes an admin must decide. A holder's approval is
    // final, so these are claims on a sale nobody holds (`admin-ruling`).
    for (const d of rulings) {
      const filer = d.createdByName || 'A former agent';
      lines.push({
        key: `ruling-${d.id}`,
        text: `${formatMoney(d.saleAmount)} claimed by ${filer} on a sale nobody holds — needs your ruling`,
        action: { label: 'Review', run: () => openDetail(d) },
      });
    }

    const offSchedule = data.flags.offSchedule;
    if (offSchedule.length > 0) {
      const unheld = offSchedule.filter(id => live.find(s => s.saleId === id && !s.userId)).length;
      lines.push({
        key: 'off-schedule',
        text: `${pluralise(offSchedule.length, 'sale')} held by someone other than the agent on shift for that account${unheld ? ` (${unheld} unassigned)` : ''}`,
        action: { label: 'Show them', run: () => showView('off-schedule') },
      });
    }

    const unmappedRows = new Map<string, { count: number; gross: number }>();
    for (const s of live) {
      if (!s.unmappedChatterId) continue;
      const e = unmappedRows.get(s.unmappedChatterId) ?? { count: 0, gross: 0 };
      e.count += 1;
      e.gross += s.signedGross;
      unmappedRows.set(s.unmappedChatterId, e);
    }
    for (const c of mapping?.chatters.filter(c => !c.uid) ?? []) {
      const rows = unmappedRows.get(c.chatterId);
      if (!rows && c.status !== 'active') continue;
      lines.push({
        key: `chatter-${c.chatterId}`,
        text: `BuddyX chatter ${c.name ?? c.chatterId}${c.email ? ` (${c.email})` : ''} matches no Bluu user${rows ? ` — ${pluralise(rows.count, 'sale')}, ${formatUsd(rows.gross)}` : ''}`,
        action: { label: 'Open mapping', run: () => setMappingOpen(true) },
      });
    }
    for (const m of mapping?.models.filter(m => !m.creatorId) ?? []) {
      const rows = live.filter(s => !s.creatorId && s.creatorName === (m.handle ?? ''));
      lines.push({
        key: `model-${m.modelId}`,
        text: `BuddyX creator @${m.handle ?? m.modelId} matches no creator${rows.length ? ` — ${pluralise(rows.length, 'sale')}` : ''}`,
        action: { label: 'Open mapping', run: () => setMappingOpen(true) },
      });
    }
    const unassignedIds = (k: 'tip' | 'ppv') => live.filter(s => !s.userId && !s.unmappedChatterId && s.kind === k).map(s => s.saleId);
    if (data.unassigned.tips > 0) {
      lines.push({
        key: 'unassigned',
        text: `${pluralise(data.unassigned.tips, 'unassigned tip')}, ${formatUsd(data.unassigned.tipsGross)}${data.unassigned.claimed ? ` · ${data.unassigned.claimed} claimed, awaiting you` : ''}`,
        action: { label: 'Show them', run: () => showRows('Unassigned tips', unassignedIds('tip')) },
      });
    }
    if (data.unassigned.ppv > 0) {
      lines.push({
        key: 'unassigned-ppv',
        text: `${pluralise(data.unassigned.ppv, 'PPV')} with no sender in BuddyX, ${formatUsd(data.unassigned.ppvGross)} — counting toward nobody`,
        action: { label: 'Show them', run: () => showRows('Unassigned PPVs', unassignedIds('ppv')) },
      });
    }
    if (data.flags.attributionConflicts.length > 0) {
      lines.push({
        key: 'conflicts',
        text: `${pluralise(data.flags.attributionConflicts.length, 'moved sale')} BuddyX has since credited to someone else — Bluu's assignment stands`,
        action: { label: 'Show them', run: () => showRows('BuddyX changed since the move', data.flags.attributionConflicts) },
      });
    }
    if (data.flags.staleLocks.length > 0) {
      lines.push({
        key: 'stale-locks',
        text: `${pluralise(data.flags.staleLocks.length, 'sale')} still locked by a dispute that is already decided — it can't be claimed; reassigning it clears the lock`,
        action: { label: 'Show them', run: () => showRows('Stale dispute locks', data.flags.staleLocks) },
      });
    }
    if (data.flags.possibleDuplicates.length > 0) {
      lines.push({
        key: 'duplicates',
        text: `${pluralise(data.flags.possibleDuplicates.length, 'sale')} share a creator, fan, time and amount with another row — check BuddyX for a double entry`,
        action: { label: 'Show them', run: () => showRows('Possible duplicates', data.flags.possibleDuplicates) },
      });
    }
    if (data.flags.zeroGross.length > 0) {
      lines.push({
        key: 'zero',
        text: `${pluralise(data.flags.zeroGross.length, 'sale')} with a $0.00 amount`,
        action: { label: 'Show them', run: () => showRows('$0 sales', data.flags.zeroGross) },
      });
    }
    for (const holder of data.flags.archivedHolders) {
      lines.push({
        key: `archived-${holder.uid}`,
        text: `${pluralise(holder.count, 'sale')}, ${formatUsd(holder.gross)}, held by ${data.names[holder.uid] ?? 'an agent'}, who is archived`,
        action: {
          label: 'Show them',
          run: () => showRows(`Held by ${data.names[holder.uid] ?? 'an archived agent'}`, live.filter(s => s.userId === holder.uid).map(s => s.saleId)),
        },
      });
    }
    if (data.flags.vanishedAfterFinalise.length > 0) {
      lines.push({
        key: 'vanished',
        text: `${pluralise(data.flags.vanishedAfterFinalise.length, 'sale')} vanished from BuddyX inside a finalised month and still count`,
        action: { label: 'Show them', run: () => showRows('Vanished after finalising', data.flags.vanishedAfterFinalise) },
      });
    }
    const counts = lastRun?.counts ?? {};
    const refused = counts['sales.rejectedFinalized'] ?? 0;
    if (refused > 0) lines.push({ key: 'refused', text: `The last sync refused ${pluralise(refused, 'change')} to a finalised month` });
    const unplaceable = counts['sales.unplaceable'] ?? 0;
    if (unplaceable > 0) {
      lines.push({ key: 'unplaceable', text: `The last sync could not place ${pluralise(unplaceable, 'BuddyX row')} (no id or no date) — they are not in the ledger` });
    }
    const ambiguous = counts['sales.rekeyAmbiguous'] ?? 0;
    if (ambiguous > 0) {
      lines.push({
        key: 'rekey-ambiguous',
        text: `The last sync saw ${pluralise(ambiguous, 'BuddyX row')} change id where more than one stored sale matched — any move on the old row did not carry over`,
      });
    }
    return lines;
    // `showRows`/`showView` only call setters; listing them would re-derive the band every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, mapping, lastRun, rulings]);

  const rangeLabel = range.from && range.to ? (range.from === range.to ? formatDayLabel(range.from) : `${formatDayLabel(range.from)} – ${formatDayLabel(range.to)}`) : '';
  const month = currentDayKey().slice(0, 7);
  const firstRow = (safePage - 1) * PAGE_SIZE + 1;
  // The Dispute column joins the table on the Disputed view only; elsewhere the
  // Type cell's "Disputed" tag is enough and the table keeps its width.
  const showDisputeColumn = view === 'disputed' && !focus;
  const columns = showDisputeColumn
    ? [...LEDGER_COLUMNS.slice(0, 3), { label: 'Dispute', hint: 'The latest claim on this sale and what it did here' }, ...LEDGER_COLUMNS.slice(3)]
    : LEDGER_COLUMNS;
  const detailStage = detail ? disputeStage(detail) : null;
  const filtersActiveBesidesView = agent !== 'all' || creatorId !== null || kind !== 'all' || query.trim() !== '';

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Sales</h2>
          <p className="mt-0.5 max-w-[70ch] text-sm text-zinc-400">
            Every sale in the period, newest first — assigned and unassigned, on every creator — and what disputes moved.
            Amounts are gross; net is gross less the platform deduction set on Rates. Days are salary days (Harare).
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <PeriodPicker
            options={[
              { value: 'today' as Period, label: 'Today' },
              { value: '7d' as Period, label: '7 days' },
              { value: 'month' as Period, label: formatMonthName(month) },
              { value: 'last-month' as Period, label: formatMonthName(addMonths(month, -1)) },
            ]}
            value={period}
            onPresetChange={setPeriod}
            from={period === 'custom' ? customFrom : dayKeyToDate(range.from)}
            to={period === 'custom' ? customTo : dayKeyToDate(range.to)}
            onRangeChange={(nextFrom, nextTo) => {
              setPeriod('custom');
              setCustomFrom(nextFrom);
              setCustomTo(nextTo);
            }}
          />
          <SyncStatus scope="sales" onSynced={() => { void load(true); void loadLastRun(); }} />
        </div>
      </div>

      {/* Independent of the period: "most recent" keeps meaning most recent. */}
      <DisputeMovesFeed
        timezone={timezone}
        refreshKey={disputeRefresh}
        onOpen={openDetail}
        onOverturn={overturn}
        onShowAll={showMovedInLedger}
      />

      {rangeProblem ? (
        <p className="text-sm text-zinc-400">{rangeProblem}</p>
      ) : loading && !data ? (
        <div className="space-y-4" aria-busy>
          <Skeleton className="h-12 w-full rounded-xl" />
          <Skeleton className="h-8 w-2/3 rounded-md" />
          <Skeleton className="h-[480px] w-full rounded-xl" />
        </div>
      ) : error && !data ? (
        <div className="flex items-center gap-3">
          <p className="text-sm text-red-400">{error}</p>
          <Button size="sm" variant="outline" onClick={() => void load(true)}>
            <RotateCcw className="size-3.5" aria-hidden /> Try again
          </Button>
        </div>
      ) : data ? (
        <>
          {/* ── Attention band (DESIGN.md §5: attention tint, static dot, names its rows) ── */}
          <section
            aria-label="Needs a look"
            className={cn(
              'rounded-xl border px-4 py-3',
              attention.length ? 'border-orange-500/20 bg-orange-500/[0.06]' : 'border-white/[0.07] bg-white/[0.025]',
            )}
          >
            {attention.length === 0 ? (
              <p className="text-sm text-zinc-400">Nothing needs a look in {rangeLabel}.</p>
            ) : (
              <ul className="space-y-1.5">
                {attention.map(line => (
                  <li key={line.key} className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="inline-block size-1.5 shrink-0 rounded-full bg-orange-400" aria-hidden />
                    <span>{line.text}</span>
                    {line.action && (
                      <Button size="xs" variant="ghost" className="h-6 text-zinc-300" onClick={line.action.run}>
                        {line.action.label}
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* ── Ledger ── */}
          <section className="space-y-3" aria-label="All sales">
            <div ref={ledgerTop} className="flex flex-wrap items-center gap-2 scroll-mt-4">
              <div className="relative min-w-0 flex-1 sm:max-w-60">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-zinc-400" aria-hidden />
                <Input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search fan, agent or sale ID" className="h-8 pl-8" aria-label="Search sales" />
              </div>
              <Select value={agent} onValueChange={setAgent}>
                <SelectTrigger size="sm" className="w-44" aria-label="Held by"><SelectValue placeholder="Agent" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All agents</SelectItem>
                  {agents.map(a => <SelectItem key={a.uid} value={a.uid}>{a.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <CreatorCombobox value={creatorId} onChange={setCreatorId} allLabel="All creators" />
              <ToggleGroup type="single" variant="outline" size="sm" value={kind} onValueChange={v => v && setKind(v as KindFilter)} aria-label="Kind">
                <ToggleGroupItem value="all" className={SEGMENT}>All</ToggleGroupItem>
                <ToggleGroupItem value="tip" className={SEGMENT}>Tips</ToggleGroupItem>
                <ToggleGroupItem value="ppv" className={SEGMENT}>PPV</ToggleGroupItem>
              </ToggleGroup>
              <InfoTip text={LEDGER_TIPS_ATTRIBUTION} />
              <InfoTip text={LEDGER_PPV_ATTRIBUTION} />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
              <div className="flex flex-wrap items-center gap-2">
              <ToggleGroup
                type="single"
                variant="outline"
                size="sm"
                value={focus ? '' : view}
                onValueChange={v => {
                  if (!v) return;
                  setFocus(null);
                  setView(v as SalesView);
                }}
                aria-label="Show"
                className="flex-wrap"
              >
                {VIEWS.map(v => (
                  <ToggleGroupItem key={v.value} value={v.value} className={SEGMENT}>
                    {v.label}
                    <span className={cn('ml-1 tabular-nums', v.value === 'off-schedule' && viewCounts.views[v.value] > 0 && view !== v.value && 'text-orange-400')}>
                      {viewCounts.views[v.value].toLocaleString()}
                    </span>
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
              {view === 'disputed' && !focus && (
                <Select value={outcome} onValueChange={v => setOutcome(v as OutcomeFilter)}>
                  <SelectTrigger size="sm" className="w-48" aria-label="Dispute outcome">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Every outcome</SelectItem>
                    <SelectSeparator />
                    {OUTCOMES.map(o => (
                      <SelectItem key={o} value={o} disabled={outcomeCounts[o] === 0 && outcome !== o}>
                        {OUTCOME_LABEL[o]} <span className="ml-1 tabular-nums text-zinc-400">{outcomeCounts[o]}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              </div>
              <p className="text-sm text-zinc-400">
                {pluralise(filtered.length, 'sale')}
                {view !== 'removed' && (
                  <>
                    {' '}·{' '}
                    <span className="tabular-nums text-foreground">{formatUsd(filtered.reduce((s, r) => s + (r.removedAt ? 0 : r.signedGross), 0))}</span> gross
                  </>
                )}
                {filtersActive && (
                  <>
                    {' '}·{' '}
                    <button type="button" onClick={clearFilters} className="rounded-sm text-foreground underline underline-offset-2 hover:text-white focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
                      Clear filters
                    </button>
                  </>
                )}
              </p>
            </div>

            {focus && (
              <div className="flex items-center gap-2 text-sm">
                <span className="text-zinc-400">Showing</span>
                <span className="font-medium">{focus.label}</span>
                <Button size="xs" variant="ghost" className="h-6 text-zinc-300" onClick={() => setFocus(null)}>
                  <X className="size-3" aria-hidden /> Back to the ledger
                </Button>
              </div>
            )}

            <BulkBar
              key={selected.length === 0 ? 'idle' : 'active'}
              selected={selected}
              schedule={schedule}
              names={data.names}
              onClear={() => setPicked(new Set())}
              onMove={async (moves, reason) => {
                try {
                  const { moved, refused } = await move(moves, reason);
                  if (moved.length) toast.success(`${pluralise(moved.length, 'sale')} moved`);
                  if (refused.length) toast.error(`${pluralise(refused.length, 'sale')} not moved — ${refused[0].error}`);
                  setPicked(new Set(refused.map(r => r.saleId)));
                  return true;
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : 'Could not move the sales');
                  return false;
                }
              }}
            />

            {filtered.length === 0 ? (
              <p className="text-sm text-zinc-400">
                {data.sales.length === 0 ? (
                  `No sales in ${rangeLabel}.`
                ) : view === 'off-schedule' && !focus ? (
                  'Every sale here is held by the agent on shift for its account, or nobody was scheduled on it.'
                ) : view === 'disputed' && !focus && viewCounts.views.disputed === 0 && !filtersActiveBesidesView ? (
                  `No sale in ${rangeLabel} was disputed.`
                ) : (
                  <>
                    Nothing matches these filters.{' '}
                    <button type="button" onClick={clearFilters} className="rounded-sm text-foreground underline underline-offset-2 hover:text-white focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
                      Clear them to see all {pluralise(viewCounts.views.all, 'sale')}
                    </button>
                  </>
                )}
              </p>
            ) : (
              <div
                tabIndex={0}
                role="region"
                aria-label="All sales, scrollable"
                className="overflow-x-auto rounded-lg border border-white/[0.07] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/50"
              >
                <table className="w-full min-w-[1280px] border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-white/[0.07]">
                      <th scope="col" className="w-9 px-3 py-2.5">
                        <Checkbox
                          checked={allPicked}
                          disabled={pageMovable.length === 0}
                          onCheckedChange={v => setPicked(v === true ? new Set(pageMovable.map(s => s.saleId)) : new Set())}
                          aria-label={allPicked ? 'Clear selection' : 'Select every movable sale on this page'}
                          className={SELECT_BOX_CLASS}
                        />
                      </th>
                      {columns.map(({ label, right, hint }) => (
                        <th key={label} scope="col" title={hint} className={cn('whitespace-nowrap px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400', right ? 'text-right' : 'text-left')}>
                          {label}
                        </th>
                      ))}
                      <th scope="col" className="px-3 py-2.5"><span className="sr-only">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.045]">
                    {pageRows.map(sale => {
                      const canMove = movable(sale, staleLocks);
                      const isPicked = canMove && picked.has(sale.saleId);
                      const match = schedule[sale.saleId];
                      const mark = disputeMarks[sale.saleId];
                      const target = canMove ? scheduleTarget(sale, schedule) : null;
                      return (
                        <tr
                          key={sale.saleId}
                          title={`Sale ${sale.saleId}`}
                          className={cn(isPicked && 'bg-action-blue/10', match?.offSchedule && !isPicked && 'bg-orange-500/[0.035]')}
                        >
                          <td className="px-3 py-2">
                            {canMove && (
                              <Checkbox
                                checked={isPicked}
                                onCheckedChange={v =>
                                  setPicked(prev => {
                                    const next = new Set(prev);
                                    if (v === true) next.add(sale.saleId);
                                    else next.delete(sale.saleId);
                                    return next;
                                  })
                                }
                                aria-label={`Select the ${formatUsd(sale.signedGross)} sale from ${formatSaleDateTime(sale.occurredAt, timezone)}`}
                                className={SELECT_BOX_CLASS}
                              />
                            )}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2 tabular-nums text-zinc-400">{formatSaleDateTime(sale.occurredAt, timezone)}</td>
                          <td className="max-w-[11rem] px-3 py-2">
                            {sale.creatorId ? <CreatorChip creatorId={sale.creatorId} name={sale.creatorName || undefined} size="xs" /> : sale.creatorName || '—'}
                          </td>
                          <td className="max-w-[14rem] px-3 py-2">
                            <span className="flex flex-col items-start gap-1">
                              {sale.userId ? (
                                <PersonTag name={data.names[sale.userId] ?? ''} photoURL={null} size="sm" />
                              ) : (
                                <span className="text-xs text-zinc-400">Unassigned</span>
                              )}
                              <SaleHolderNote sale={sale} names={data.names} />
                            </span>
                          </td>
                          {showDisputeColumn && (
                            <td className="max-w-[14rem] px-3 py-2">
                              {mark ? (
                                <OutcomeCell
                                  mark={mark}
                                  names={data.names}
                                  opening={openingDispute === mark.disputeId}
                                  onOpen={() => void openClaim(mark.disputeId)}
                                />
                              ) : (
                                <span className="text-xs text-zinc-400">—</span>
                              )}
                            </td>
                          )}
                          <td className="max-w-[12rem] px-3 py-2 text-xs">
                            <OnShift match={match} names={data.names} />
                          </td>
                          <td className="max-w-[12rem] px-3 py-2 text-xs">
                            {sale.unmappedChatterId ? (
                              <span className="text-orange-400">{sale.employeeName || `Chatter ${sale.unmappedChatterId}`} (not linked)</span>
                            ) : sale.buddyxUserId ? (
                              <span className="text-zinc-300">
                                {data.names[sale.buddyxUserId] ?? sale.employeeName}
                                {sale.attributedBy === 'departed' && <span className="text-zinc-400"> · no longer here</span>}
                              </span>
                            ) : (
                              <span className="text-zinc-400">Unassigned</span>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            <span className="flex flex-wrap items-center gap-1.5">
                              <AttrChip>{saleTypeLabel(sale.type)}</AttrChip>
                              {data.spansCutover && <AttrChip>{sale.source === 'buddyx' ? 'BuddyX' : 'Infloww'}</AttrChip>}
                              {sale.status === 'reverse' && <span className="text-[11px] text-red-400">Reversed</span>}
                              {sale.disputeId && !showDisputeColumn && (
                                <span className={cn('text-[11px]', staleLocks.has(sale.saleId) ? 'text-orange-400' : 'text-zinc-300')}>
                                  {staleLocks.has(sale.saleId) ? 'Locked by a decided dispute' : 'Disputed'}
                                </span>
                              )}
                              {flagged.duplicates.has(sale.saleId) && <span className="text-[11px] text-orange-400">Possible duplicate</span>}
                              {flagged.zero.has(sale.saleId) && <span className="text-[11px] text-orange-400">$0</span>}
                              {sale.vanishedAfterFinalise && <span className="text-[11px] text-orange-400">Gone from BuddyX after finalising</span>}
                              {sale.removedAt && (
                                <span className="text-[11px] text-zinc-400">
                                  Removed {formatSaleDateTime(sale.removedAt, timezone)} — no longer in BuddyX
                                </span>
                              )}
                            </span>
                          </td>
                          <td className="max-w-[12rem] px-3 py-2"><FanLabel name={sale.fanName} fanId={sale.fanId} className="block" linkToReport={fanReports} /></td>
                          <td className={cn('whitespace-nowrap px-3 py-2 text-right tabular-nums', sale.removedAt ? 'text-zinc-400 line-through' : signedMoneyClass(sale.signedGross))}>
                            {formatUsd(sale.signedGross)}
                          </td>
                          <td className={cn('whitespace-nowrap px-3 py-2 text-right tabular-nums', sale.removedAt ? 'text-zinc-400 line-through' : 'text-zinc-300')}>
                            {formatUsd(net(sale.signedGross))}
                          </td>
                          <td className="whitespace-nowrap px-2 py-1 text-right">
                            <span className="inline-flex items-center justify-end gap-1">
                              {target && (
                                <Button
                                  size="xs"
                                  variant="ghost"
                                  className="h-6 max-w-[11rem] border border-orange-500/30 bg-orange-500/10 text-orange-300 hover:bg-orange-500/20 hover:text-orange-200 dark:hover:bg-orange-500/20"
                                  disabled={moving !== null}
                                  onClick={() => void moveToSchedule(sale)}
                                  aria-label={`Move this ${formatUsd(sale.signedGross)} sale to ${nameOf(target)}, who was on shift for the account`}
                                >
                                  {moving === sale.saleId ? (
                                    <Loader2Icon className="activity-spinner size-3 animate-spin" aria-hidden />
                                  ) : (
                                    <ArrowRight className="size-3" aria-hidden />
                                  )}
                                  <span className="truncate">Move to {nameOf(target)}</span>
                                </Button>
                              )}
                              {!sale.removedAt && (
                                <Button
                                  size="xs"
                                  variant="ghost"
                                  className="h-6 text-zinc-300"
                                  disabled={!canMove}
                                  title={!canMove ? 'An open dispute holds this sale — rule on it first' : undefined}
                                  onClick={() => setReassigning(sale)}
                                >
                                  {sale.userId ? 'Reassign' : 'Assign'}
                                </Button>
                              )}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {filtered.length > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm tabular-nums text-zinc-400">
                  {totalPages > 1
                    ? `Showing ${firstRow.toLocaleString()}–${(firstRow + pageRows.length - 1).toLocaleString()} of ${filtered.length.toLocaleString()}`
                    : pluralise(filtered.length, 'sale')}
                </p>
                <EllipsisPagination page={safePage} totalPages={totalPages} onPageChange={goToPage} className="mx-0 w-auto justify-end" />
              </div>
            )}
          </section>

          <ReassignSaleDialog
            sale={reassigning}
            names={data.names}
            schedule={schedule}
            timezone={timezone}
            authed={authed}
            onOpenChange={open => !open && setReassigning(null)}
            onDone={async () => {
              setReassigning(null);
              await load(true);
            }}
          />
        </>
      ) : null}

      <DisputeDetailDialog
        dispute={detail}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        timezone={timezone}
        onAction={detailStage === 'awaiting-ca' || detailStage === 'awaiting-admin' ? rule : undefined}
        onUntransfer={detail?.version === 2 && detailStage === 'approved' ? untransfer : undefined}
        onOverturn={detailStage === 'approved' ? overturn : undefined}
      />

      {/* ── Machinery, collapsed ── */}
      <Section title="Mapping" open={mappingOpen} onOpenChange={setMappingOpen}>
        <MappingSection mapping={mapping} isAdmin={isAdmin} authed={authed} onChanged={loadMapping} />
      </Section>
    </div>
  );
}

// ─── Pieces ──────────────────────────────────────────────────────────

/**
 * The Disputed view's cell: what the latest claim on this sale did here, as a
 * status pill that opens the claim (the argument, who approved it, Overturn).
 *
 * The pill is the control rather than the row, because the row already holds
 * Reassign and the selection box. The Meta line names the people — who
 * claimed it, from whom — and, for a sale an approval could not move, why.
 */
function OutcomeCell({
  mark,
  names,
  opening,
  onOpen,
}: {
  mark: SaleDisputeMark;
  names: Record<string, string>;
  opening: boolean;
  onOpen: () => void;
}) {
  const filer = names[mark.filedBy] || 'a former agent';
  const from = mark.claimedFrom ? names[mark.claimedFrom] || 'a former agent' : 'nobody';
  return (
    <span className="flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={onOpen}
        disabled={opening}
        aria-label={`${OUTCOME_LABEL[mark.outcome]} — open the claim ${filer} filed`}
        className={cn(
          PILL_CLASS,
          'gap-1 transition-[filter] duration-[120ms] hover:brightness-125 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-70',
          outcomePillClass(mark.outcome),
        )}
      >
        {opening && <Loader2Icon className="activity-spinner size-3 animate-spin" aria-hidden />}
        {OUTCOME_LABEL[mark.outcome]}
      </button>
      <span className="text-[11px] text-zinc-400">
        {filer} claimed it from {from}
        {mark.earlier > 0 && <> · {pluralise(mark.earlier, 'earlier claim')}</>}
      </span>
      {mark.skipReason && <span className="text-[11px] text-orange-400">Not moved — {mark.skipReason}</span>}
    </span>
  );
}

const LEDGER_COLUMNS: Array<{ label: string; right?: boolean; hint?: string }> = [
  { label: 'When' },
  { label: 'Creator' },
  { label: 'Held by' },
  { label: 'On shift', hint: 'Who the shift schedule had on this account at the time of sale' },
  { label: 'BuddyX credits' },
  { label: 'Type' },
  { label: 'Fan' },
  { label: 'Gross', right: true },
  { label: 'Net', right: true },
];

/**
 * The shift schedule's answer for one row, read across from *Held by*. The
 * word carries the finding (*Off schedule*), the hue only repeats it.
 */
function OnShift({ match, names }: { match: ScheduleMatch | undefined; names: Record<string, string> }) {
  if (!match) {
    return (
      <span className="text-zinc-400" title="Nobody was scheduled on this account at the time of sale">
        —<span className="sr-only">Nobody scheduled</span>
      </span>
    );
  }
  const who = match.scheduled.map(uid => holderName(uid, names)).join(', ');
  if (!match.offSchedule) return <span className="text-zinc-300">{who}</span>;
  return (
    <span className="flex flex-col items-start gap-0.5">
      <span className="text-zinc-200">{who}</span>
      <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-orange-400">
        <span className="inline-block size-1.5 rounded-full bg-orange-400" aria-hidden />
        Off schedule
      </span>
    </span>
  );
}

const ON_SHIFT = '__on_shift__';
const NOBODY = '__nobody__';

/**
 * The selection bar. It **holds its height at zero selection** so the first
 * tick never shoves the row under the cursor, and it moves only the rows on
 * screen. *Each to the agent on shift* moves every selected off-schedule row
 * with one scheduled agent onto that agent — one request, several targets.
 */
function BulkBar({
  selected,
  schedule,
  names,
  onClear,
  onMove,
}: {
  selected: SalarySale[];
  schedule: Record<string, ScheduleMatch>;
  names: Record<string, string>;
  onClear: () => void;
  onMove: (moves: Array<{ saleId: string; toUserId: string | null }>, reason: string) => Promise<boolean>;
}) {
  const { users } = useBasicUsers(selected.length > 0);
  const [picked, setTarget] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const onShift = useMemo(
    () => selected.flatMap(s => {
      const to = scheduleTarget(s, schedule);
      return to ? [{ saleId: s.saleId, toUserId: to }] : [];
    }),
    [selected, schedule],
  );

  // The bar remounts whenever the selection empties (its `key`), which is what resets it.
  const target = picked === ON_SHIFT && onShift.length === 0 ? '' : picked;

  if (selected.length === 0) {
    return (
      <div className="flex h-9 items-center text-[11px] text-zinc-400">
        Select sales to assign them together — or use <span className="mx-1 font-medium text-zinc-300">Move to</span> on an off-schedule row.
      </div>
    );
  }

  const gross = selected.reduce((sum, s) => round2(sum + s.signedGross), 0);
  const moves =
    target === ON_SHIFT
      ? onShift
      : target
        ? selected.map(s => ({ saleId: s.saleId, toUserId: target === NOBODY ? null : target }))
        : [];
  const ready = moves.length > 0 && reason.trim().length >= 3 && !busy;

  const run = async () => {
    if (!ready) return;
    setBusy(true);
    const ok = await onMove(moves, reason.trim());
    setBusy(false);
    if (ok) {
      setTarget('');
      setReason('');
    }
  };

  return (
    <div className="flex min-h-9 flex-wrap items-center gap-2 rounded-lg border border-action-blue/20 bg-action-blue/[0.06] px-3 py-1.5">
      <span className="text-sm font-medium tabular-nums text-white">
        {pluralise(selected.length, 'sale')} selected <span className="font-normal text-zinc-400">· {formatUsd(gross)} gross</span>
      </span>
      <Button size="sm" variant="ghost" onClick={onClear} disabled={busy} className="h-7 px-2 text-zinc-400 hover:text-white">
        Clear
      </Button>
      <div className="ml-auto flex flex-wrap items-center gap-2">
        <Select
          value={target}
          onValueChange={v => {
            setTarget(v);
            if (v === ON_SHIFT && !reason.trim()) setReason(SCHEDULE_REASON);
          }}
          disabled={busy}
        >
          <SelectTrigger size="sm" className="h-8 w-60" aria-label="Move the selected sales to">
            <SelectValue placeholder="Move to…" />
          </SelectTrigger>
          <SelectContent>
            {onShift.length > 0 && (
              <>
                <SelectItem value={ON_SHIFT}>
                  Each to the agent on shift ({onShift.length === selected.length ? 'all' : `${onShift.length} of ${selected.length}`})
                </SelectItem>
                <SelectSeparator />
              </>
            )}
            {activeChatAgents(users).map(u => <SelectItem key={u.uid} value={u.uid}>{u.displayName}</SelectItem>)}
            <SelectItem value={NOBODY}>Nobody (unassigned)</SelectItem>
          </SelectContent>
        </Select>
        <label htmlFor="bulk-move-reason" className="sr-only">Why — shown on the ledger and on each agent&apos;s report</label>
        <Input
          id="bulk-move-reason"
          value={reason}
          maxLength={500}
          placeholder="Why — shown on the ledger"
          onChange={e => setReason(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') void run();
            if (e.key === 'Escape') onClear();
          }}
          className="h-8 w-64"
          disabled={busy}
        />
        <Button size="sm" onClick={() => void run()} disabled={!ready}>
          {busy && <Loader2Icon className="activity-spinner size-3.5 animate-spin" aria-hidden />}
          {target === ON_SHIFT ? `Move ${onShift.length}` : `Move ${selected.length}`}
        </Button>
      </div>
      {target === ON_SHIFT && onShift.length < selected.length && (
        <p className="basis-full text-[11px] text-zinc-400">
          {pluralise(selected.length - onShift.length, 'sale')} stay where {selected.length - onShift.length === 1 ? 'it is' : 'they are'} — not off schedule, or more than one agent was on shift.
        </p>
      )}
      {target && target !== ON_SHIFT && target !== NOBODY && (
        <p className="basis-full text-[11px] text-zinc-400">
          {holderName(target, { ...names, ...Object.fromEntries(users.map(u => [u.uid, u.displayName])) })} gains {formatUsd(gross)} gross; every holder&apos;s figures recompute.
        </p>
      )}
    </div>
  );
}

/**
 * Assign or reassign one sale — Bluu Backend is the source of truth, so
 * this is the fix an admin used to make in BuddyX (which cannot move a PPV at
 * all). The agents the shift schedule had on the account come first, then the
 * one the sync credits and the one BuddyX credits; all are labelled, because
 * "put it where the schedule says" and "put it back" are the two commonest
 * corrections. A reason is
 * required: it is shown on the row and on the agent's report.
 *
 * The server re-checks everything (open dispute, finalised months, archived
 * target) inside a transaction; a refusal keeps the dialog open with the
 * choice and the reason intact.
 */
function ReassignSaleDialog({
  sale,
  names,
  schedule,
  timezone,
  authed,
  onOpenChange,
  onDone,
}: {
  sale: SalarySale | null;
  names: Record<string, string>;
  schedule: Record<string, ScheduleMatch>;
  timezone: string;
  authed: Authed;
  onOpenChange: (open: boolean) => void;
  onDone: () => Promise<void>;
}) {
  const open = sale !== null;
  const { users } = useBasicUsers(open);
  const [target, setTarget] = useState<string>('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const onShift = useMemo(() => (sale ? schedule[sale.saleId]?.scheduled ?? [] : []), [sale, schedule]);

  // An off-schedule sale with one agent on shift opens with that fix chosen.
  useEffect(() => {
    const suggested = sale ? scheduleTarget(sale, schedule) : null;
    setTarget(suggested ?? '');
    setReason(suggested ? SCHEDULE_REASON : '');
    setError(null);
    // Reset per sale only — a sync landing while the dialog is open must not wipe what was typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sale?.saleId]);

  const allNames = useMemo(
    () => ({ ...Object.fromEntries(users.map(u => [u.uid, u.displayName])), ...names }),
    [users, names],
  );
  const nameOf = (uid: string | null) => holderName(uid, allNames);
  const agents = useMemo(() => activeChatAgents(users), [users]);
  // Only people a sale can be moved to: the server refuses an archived target,
  // so BuddyX's credit to someone who has left is shown above, never offered.
  const assignable = new Set(agents.map(u => u.uid));
  const pinned = new Set(
    [...onShift, sale?.sourceUserId, sale?.buddyxUserId].filter((uid): uid is string => Boolean(uid) && assignable.has(uid!)),
  );

  if (!sale) return null;
  const toUserId = target === NOBODY ? null : target || undefined;
  const backToBuddyx = toUserId !== undefined && toUserId === sale.sourceUserId;
  // The server's own rule, so the button and the refusal can never disagree.
  const unchanged =
    toUserId !== undefined &&
    reassignRefusal(
      { userId: sale.userId, sourceUserId: sale.sourceUserId, hasTransfer: Boolean(sale.transfer), removed: false, disputeId: null, month: sale.month },
      toUserId,
      () => false,
    ) === 'same';
  const gross = formatUsd(sale.signedGross);
  const consequence = unchanged
    ? 'It is already held there.'
    : [
        backToBuddyx &&
          (sale.attributedBy === 'schedule'
            ? 'Clears the override — the sale goes back to the agent on shift.'
            : sale.attributedBy === 'departed'
              ? 'Clears the override — the sale goes back to unassigned.'
              : 'Clears the override — the sale matches BuddyX again.'),
        sale.userId ? `${nameOf(sale.userId)} loses ${gross} gross.` : `${gross} gross, unassigned until now.`,
        toUserId ? `${nameOf(toUserId)} gains it.` : 'It will count toward nobody.',
        `Both agents’ ${sale.month} figures recompute.`,
      ]
        .filter(Boolean)
        .join(' ');
  const tags = (uid: string) =>
    [
      onShift.includes(uid) && 'on shift',
      uid === sale.buddyxUserId && 'matches BuddyX',
      uid === sale.sourceUserId && sale.attributedBy === 'schedule' && 'assigned by shift',
    ]
      .filter(Boolean)
      .join(' · ');

  async function submit() {
    if (toUserId === undefined || !sale) return;
    if (reason.trim().length < 3) {
      setError('Say why — it is shown on the ledger and on the agent’s report.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await authed(`/api/ca-sales/${encodeURIComponent(sale.saleId)}/transfer`, {
        method: 'PUT',
        body: JSON.stringify({ toUserId, reason: reason.trim() }),
      });
      toast.success(backToBuddyx ? (sale.attributedBy === 'schedule' ? 'Sale back with the agent on shift' : 'Sale back on BuddyX’s attribution') : `Sale ${sale.userId ? 'reassigned' : 'assigned'} to ${nameOf(toUserId)}`);
      await onDone();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not reassign the sale';
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={next => !busy && onOpenChange(next)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{sale.userId ? 'Reassign sale' : 'Assign sale'}</DialogTitle>
          <DialogDescription>
            Moves the sale in Bluu Backend. Pay follows it, and later BuddyX syncs keep it.
          </DialogDescription>
        </DialogHeader>

        <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1.5 text-sm">
          <dt className="text-zinc-400">Sale</dt>
          <dd className="flex flex-wrap items-center gap-1.5">
            <span className="tabular-nums">{formatUsd(sale.signedGross)}</span>
            <span className="text-zinc-400">gross ·</span>
            <AttrChip>{saleTypeLabel(sale.type)}</AttrChip>
            <span className="tabular-nums text-zinc-400">{formatSaleDateTime(sale.occurredAt, timezone)}</span>
          </dd>
          <dt className="text-zinc-400">Creator · fan</dt>
          <dd className="flex min-w-0 items-center gap-1.5">
            {sale.creatorId ? <CreatorChip creatorId={sale.creatorId} name={sale.creatorName || undefined} size="xs" /> : sale.creatorName || '—'}
            <span className="text-zinc-400">·</span>
            <FanLabel name={sale.fanName} fanId={sale.fanId} className="min-w-0" />
          </dd>
          <dt className="text-zinc-400">Held by</dt>
          <dd className="flex flex-wrap items-center gap-1.5">
            {nameOf(sale.userId)}
            <SaleHolderNote sale={sale} names={names} />
          </dd>
          <dt className="text-zinc-400">On shift</dt>
          <dd className={cn(schedule[sale.saleId]?.offSchedule && 'text-orange-400')}>
            {onShift.length ? onShift.map(uid => nameOf(uid)).join(', ') : <span className="text-zinc-400">Nobody scheduled on this account</span>}
            {schedule[sale.saleId]?.offSchedule && <span className="text-[11px]"> · off schedule</span>}
          </dd>
          <dt className="text-zinc-400">BuddyX credits</dt>
          <dd>{buddyxCreditName(sale, allNames)}</dd>
          <dt className="text-zinc-400">Sale ID</dt>
          <dd className="font-mono text-xs text-zinc-300">{sale.saleId}</dd>
        </dl>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="reassign-target" className="text-xs text-zinc-400">Move to</Label>
          <Select
            value={target}
            onValueChange={v => {
              setTarget(v);
              setError(null);
              if (onShift.includes(v) && !reason.trim()) setReason(SCHEDULE_REASON);
            }}
          >
            <SelectTrigger id="reassign-target" size="sm" className="w-full">
              <SelectValue placeholder="Pick an agent" />
            </SelectTrigger>
            <SelectContent>
              {[...pinned].map(uid => (
                <SelectItem key={uid} value={uid}>{nameOf(uid)}{tags(uid) && ` — ${tags(uid)}`}</SelectItem>
              ))}
              {pinned.size > 0 && <SelectSeparator />}
              {agents.filter(u => !pinned.has(u.uid)).map(u => <SelectItem key={u.uid} value={u.uid}>{u.displayName}</SelectItem>)}
              <SelectItem value={NOBODY}>
                Nobody (unassigned){sale.sourceUserId === null && sale.attributedBy !== 'departed' ? ' — matches BuddyX' : ''}
              </SelectItem>
            </SelectContent>
          </Select>
          {toUserId !== undefined && (
            <p className="text-[11px] text-zinc-400" aria-live="polite">{consequence}</p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="reassign-reason" className="text-xs text-zinc-400">Why</Label>
          <Textarea
            id="reassign-reason"
            value={reason}
            maxLength={500}
            rows={2}
            onChange={e => { setReason(e.target.value); setError(null); }}
            placeholder="Queen was on shift with this fan; BuddyX credited the sender's account."
          />
        </div>

        {error && <p role="alert" className="text-sm text-red-400">{error}</p>}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={() => void submit()} disabled={busy || toUserId === undefined || unchanged}>
            {busy && <Loader2Icon className="activity-spinner size-3.5 animate-spin" aria-hidden />}
            {sale.userId ? 'Reassign' : 'Assign'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Section({
  title,
  children,
  open,
  onOpenChange,
}: {
  title: string;
  children: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  return (
    <Collapsible open={open} onOpenChange={onOpenChange} className={cn('rounded-xl', SURFACE)}>
      <CollapsibleTrigger className="group flex w-full items-center justify-between rounded-xl px-4 py-3 text-left text-sm font-semibold focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/50">
        {title}
        <ChevronDown className="size-4 text-zinc-400 transition-transform group-data-[state=open]:rotate-180" aria-hidden />
      </CollapsibleTrigger>
      <CollapsibleContent className="border-t border-white/[0.07] px-4 py-4">{children}</CollapsibleContent>
    </Collapsible>
  );
}

type Authed = ReturnType<typeof useAuthFetch>;

function MappingSection({
  mapping,
  isAdmin,
  authed,
  onChanged,
}: {
  mapping: MappingResponse | null;
  isAdmin: boolean;
  authed: Authed;
  onChanged: () => Promise<void>;
}) {
  const { users } = useBasicUsers(isAdmin);
  const [busy, setBusy] = useState<string | null>(null);

  const link = async (kind: 'chatter' | 'model', id: string, target: string | null) => {
    setBusy(id);
    try {
      await authed('/api/admin/buddyx/mapping', { method: 'PATCH', body: JSON.stringify({ kind, id, target }) });
      await onChanged();
      toast.success(target ? 'Linked — open-month sales re-stamp on the next sync' : 'Manual link cleared — the automatic match applies on the next sync');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save the link');
    } finally {
      setBusy(null);
    }
  };

  if (!mapping) return <Skeleton className="h-32 w-full rounded-lg" />;

  const matchLabel: Record<string, string> = { email: 'email', handle: 'handle', manual: 'manual', none: 'unmatched' };

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Chatters</h3>
        {mapping.chatters.length === 0 ? (
          <p className="mt-2 text-sm text-zinc-400">No BuddyX team members synced yet.</p>
        ) : (
          <ul className="mt-2 divide-y divide-white/[0.07]">
            {mapping.chatters.map(c => (
              <li key={c.chatterId} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                <span className="min-w-0 flex-1">
                  {c.name ?? `Chatter ${c.chatterId}`}
                  <span className="block truncate text-[11px] text-zinc-400">
                    {c.email ?? 'no email'} · <span className="font-mono">{c.chatterId}</span>
                    {c.status && c.status !== 'active' && ` · ${c.status}`}
                  </span>
                </span>
                <span className="w-44">
                  {c.uid ? <PersonTag name={c.displayName ?? ''} photoURL={null} size="sm" /> : <span className="text-xs text-orange-400">No Bluu user</span>}
                </span>
                <AttrChip>{matchLabel[c.match]}</AttrChip>
                {isAdmin && (
                  <Select
                    value={c.match === 'manual' ? c.uid ?? '__none__' : '__none__'}
                    onValueChange={v => void link('chatter', c.chatterId, v === '__none__' ? null : v)}
                    disabled={busy === c.chatterId}
                  >
                    <SelectTrigger size="sm" className="w-44" aria-label={`Link ${c.name ?? c.chatterId} manually`}>
                      <SelectValue placeholder="Link manually" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Automatic (by email)</SelectItem>
                      {activeChatAgents(users).map(u => <SelectItem key={u.uid} value={u.uid}>{u.displayName}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Creators</h3>
        {mapping.models.length === 0 ? (
          <p className="mt-2 text-sm text-zinc-400">No BuddyX creators synced yet.</p>
        ) : (
          <ul className="mt-2 divide-y divide-white/[0.07]">
            {mapping.models.map(m => (
              <li key={m.modelId} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                <span className="min-w-0 flex-1">
                  @{m.handle ?? '—'}
                  <span className="block truncate text-[11px] text-zinc-400">
                    {m.customName ? `${m.customName} · ` : ''}<span className="font-mono">{m.modelId}</span>
                  </span>
                </span>
                <span className="w-44">
                  {m.creatorId ? <CreatorChip creatorId={m.creatorId} size="xs" /> : <span className="text-xs text-orange-400">No creator</span>}
                </span>
                <AttrChip>{matchLabel[m.match]}</AttrChip>
                {isAdmin && (
                  <CreatorCombobox
                    value={m.match === 'manual' ? m.creatorId : null}
                    onChange={id => void link('model', m.modelId, id)}
                    allLabel="Automatic (by handle)"
                    ariaLabel={`Link @${m.handle ?? m.modelId} manually`}
                    className="w-44"
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      {!isAdmin && <p className="text-[11px] text-zinc-400">Linking manually needs an administrator account.</p>}
    </div>
  );
}
