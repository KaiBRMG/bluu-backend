'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  Loader2Icon,
  Lock,
  LockOpen,
  Pencil,
  RotateCcw,
  TriangleAlert,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { MonthPicker } from '@/components/salary/MonthPicker';
import { SALARY_HISTORY_START_MONTH } from '@/lib/salary/salaryConstants';
import { SalaryDayTable } from '@/components/salary/SalaryDayTable';
import { SalesReport } from '@/components/salary/SalesReport';
import { CommissionLadder } from '@/components/salary/CommissionLadder';
import { useAuth } from '@/components/AuthProvider';
import { ApiError, useAuthFetch } from '@/hooks/useAuthFetch';
import { sumMonth } from '@/lib/salary/salaryEngine';
import { useSalaryMonth } from '@/hooks/useSalaryMonth';
import { getAvatarColor, getInitials } from '@/lib/utils/avatar';
import { formatMonthLabel } from '@/lib/salary/salaryDate';
import { SELECT_BOX_CLASS } from '@/lib/surfaces';
import { formatHours, formatPercent, formatRelative, formatUsd, pluralise } from '@/lib/salary/salaryFormat';
import type { SalaryMonthTotals, SalaryTierProgress } from '@/lib/salary/salaryTypes';
import { useViewerTimezone } from '@/hooks/useViewerTimezone';

/**
 * Payroll: every chat agent's month, and one agent's month in detail.
 *
 * Two views in one tab, switched in **page state rather than a route**. The
 * roster's data is already in memory when you open an agent, so a route change
 * would cost a refetch and an app-shell remount for a view nobody shares by URL
 * (DESIGN.md §5, and CLAUDE.md's app-shell known issue).
 *
 * The roster deliberately shows two warning counts per agent — days an admin has
 * edited, and days where sales arrived with no shift on record. They are the two
 * ways a month can be quietly wrong, and both are invisible from the totals
 * alone. The Overview tab rolls the same two counts up across the roster.
 *
 * **The month is owned by the page, not by this panel** (ca-salary.md §10 — one
 * month governs each surface). Overview and Payroll are read together: stepping
 * back a month on one and finding the other still on this one is the kind of
 * mismatch that gets a figure quoted from the wrong month. **So is the open
 * agent** — the page keeps it in `?agent=`, so Overview can open someone here
 * and a link can point at one person's month.
 *
 * ## Month close is one action, not a loop
 *
 * `Finalise ready` finalises every open agent whose month has no day with sales
 * but no shift — the one roster signal that the figures are still wrong. The
 * dialog names who is included and who is held back and why, so the deadline
 * task is one confirm rather than open → finalise → back per agent. Each agent
 * is finalised through the same single-agent route, sequentially, so a failure
 * names exactly who was not closed and everything else stands.
 */

interface RosterRow {
  uid: string;
  displayName: string;
  photoURL: string | null;
  workEmail: string | null;
  totals: SalaryMonthTotals | null;
  tier: SalaryTierProgress | null;
  status: 'open' | 'finalized';
  finalizedAt: string | null;
  finalizedByName: string | null;
  overriddenDays: number;
  missingShiftDays: number;
}

interface RosterResponse {
  month: string;
  rows: RosterRow[];
  payrollTotal: number;
  finalizedCount: number;
}

type SortKey = 'name' | 'gross' | 'commission' | 'hours' | 'wage' | 'salary';

const COLUMNS: Array<{
  key: Exclude<SortKey, 'name'>;
  label: string;
  value: (t: SalaryMonthTotals) => number;
  format: (n: number) => string;
  emphasis?: boolean;
}> = [
  { key: 'gross', label: 'Gross', value: t => t.grossEarnings, format: n => formatUsd(n) },
  { key: 'commission', label: 'Commission', value: t => t.commission, format: n => formatUsd(n) },
  { key: 'hours', label: 'Hours', value: t => t.hours, format: formatHours },
  { key: 'wage', label: 'Hourly pay', value: t => t.wage, format: n => formatUsd(n) },
  { key: 'salary', label: 'Salary', value: t => t.salary, format: n => formatUsd(n), emphasis: true },
];

/** A row with no month yet reads as zeros — the engine's own empty total, not a hand-built one. */
const ZERO_TOTALS = sumMonth([]);

const HEAD = 'text-[11px] font-semibold uppercase tracking-wide text-zinc-400';

/** Open, with nothing on the roster saying its figures are still wrong. */
function isReady(row: RosterRow): boolean {
  return row.status === 'open' && row.missingShiftDays === 0;
}

export default function AdminSalaries({
  month,
  onMonthChange,
  agentUid,
  onAgentChange,
}: {
  month: string;
  onMonthChange: (month: string) => void;
  /** The agent open in detail, owned by the page (`?agent=`). */
  agentUid: string | null;
  onAgentChange: (uid: string | null) => void;
}) {
  const { user } = useAuth();
  const [data, setData] = useState<RosterResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'salary', desc: true });
  const [closeOpen, setCloseOpen] = useState(false);
  // A fresh dialog per opening: last time's exclusions and failures must not
  // carry into a new close.
  const [closeKey, setCloseKey] = useState(0);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const token = await user.getIdToken();
      const res = await fetch(`/api/ca-salary/roster?month=${month}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        let message = `Could not load payroll (${res.status})`;
        try {
          const body = await res.json();
          if (body?.error) message = body.error;
        } catch {
          /* keep the status-based message */
        }
        throw new Error(message);
      }
      const body = (await res.json()) as RosterResponse;
      // A month change must not leave the previous month's rows on screen under
      // the new month's heading while this request was in flight.
      setData(body.month === month ? body : null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load payroll');
    } finally {
      setLoading(false);
    }
  }, [user, month]);

  useEffect(() => {
    void load();
  }, [load]);

  const sortColumn = COLUMNS.find(c => c.key === sort.key);
  const rows = useMemo(() => {
    const list = [...(data?.rows ?? [])];
    const column = sortColumn;
    list.sort((a, b) => {
      const diff = column
        ? column.value(a.totals ?? ZERO_TOTALS) - column.value(b.totals ?? ZERO_TOTALS)
        : a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' });
      return sort.desc ? -diff : diff;
    });
    return list;
  }, [data, sortColumn, sort.desc]);

  const ready = rows.filter(isReady);
  const blocked = rows.filter(r => r.status === 'open' && !isReady(r));

  const selectedIndex = agentUid ? rows.findIndex(r => r.uid === agentUid) : -1;
  const selected = selectedIndex >= 0 ? rows[selectedIndex] : null;

  if (agentUid && !data && loading) return <Skeleton className="h-96 w-full rounded-lg" />;

  if (selected) {
    return (
      <AgentDetail
        key={selected.uid}
        row={selected}
        month={month}
        position={{ index: selectedIndex, count: rows.length }}
        onPrevious={selectedIndex > 0 ? () => onAgentChange(rows[selectedIndex - 1].uid) : undefined}
        onNext={selectedIndex < rows.length - 1 ? () => onAgentChange(rows[selectedIndex + 1].uid) : undefined}
        onBack={() => {
          onAgentChange(null);
          void load();
        }}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Payroll</h2>
          <p className="mt-0.5 text-sm text-zinc-400">
            {data
              ? `${formatUsd(data.payrollTotal)} across ${pluralise(data.rows.length, 'agent')}`
              : 'Every chat agent’s month'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {data && ready.length > 0 && (
            <Button
              size="sm"
              onClick={() => {
                setCloseKey(k => k + 1);
                setCloseOpen(true);
              }}
            >
              <Lock className="size-3.5" aria-hidden />
              Finalise {pluralise(ready.length, 'ready agent')}
            </Button>
          )}
          <MonthPicker month={month} onChange={onMonthChange} earliest={SALARY_HISTORY_START_MONTH} />
        </div>
      </div>

      {/* Refetches keep the table on screen; only a first load shows a skeleton. */}
      {loading && !data && <Skeleton className="h-80 w-full rounded-lg" />}
      {error && !loading && (
        <p className="flex flex-wrap items-center gap-2 text-sm text-red-400">
          {error}
          <Button size="xs" variant="ghost" className="text-red-400 hover:text-red-300" onClick={() => void load()}>
            <RotateCcw className="size-3" aria-hidden />
            Retry
          </Button>
        </p>
      )}

      {data && data.rows.length === 0 && (
        <p className="text-sm text-zinc-400">
          No chat agents found. Add users to the CA group in User Management to see them here.
        </p>
      )}

      {data && data.rows.length > 0 && (
        <>
          <div className="overflow-x-auto rounded-lg border border-white/[0.07]" aria-busy={loading}>
            <table className="w-full min-w-[760px] border-collapse text-sm">
              <caption className="sr-only">
                {formatMonthLabel(month)} payroll, sorted by {sortColumn?.label ?? 'name'}
              </caption>
              <thead>
                <tr className="border-b border-white/[0.07]">
                  <SortHeader label="Agent" sortKey="name" sort={sort} onSort={setSort} align="left" />
                  {COLUMNS.map(column => (
                    <SortHeader key={column.key} label={column.label} sortKey={column.key} sort={sort} onSort={setSort} />
                  ))}
                  <th scope="col" className="w-10 px-3 py-2.5">
                    <span className="sr-only">Open</span>
                  </th>
                </tr>
              </thead>

              <tbody className="divide-y divide-white/[0.045]">
                {rows.map(row => (
                  <tr
                    key={row.uid}
                    className="group transition-colors duration-[120ms] hover:bg-white/[0.055] focus-within:bg-white/[0.055]"
                  >
                    <td className="px-3 py-2.5">
                      <button
                        type="button"
                        onClick={() => onAgentChange(row.uid)}
                        aria-label={`Open ${row.displayName}'s ${formatMonthLabel(month)} salary`}
                        className="flex w-full items-center gap-2.5 rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action-blue"
                      >
                        <Avatar className="size-7 shrink-0">
                          <AvatarImage src={row.photoURL ?? undefined} alt="" />
                          <AvatarFallback className="font-medium text-white" style={{ backgroundColor: getAvatarColor(row.displayName) }}>
                            {getInitials(row.displayName)}
                          </AvatarFallback>
                        </Avatar>
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{row.displayName}</span>
                          <RowFlags row={row} />
                        </span>
                      </button>
                    </td>

                    {COLUMNS.map(column => (
                      <td
                        key={column.key}
                        className={cn('px-3 py-2.5 text-right tabular-nums', column.emphasis && 'font-medium')}
                      >
                        {column.format(column.value(row.totals ?? ZERO_TOTALS))}
                      </td>
                    ))}
                    <td className="px-3 py-2.5 text-right">
                      <ChevronRight
                        className="ml-auto size-4 text-zinc-500 transition-transform duration-[120ms] group-hover:translate-x-0.5"
                        aria-hidden
                      />
                    </td>
                  </tr>
                ))}
              </tbody>

              <tfoot>
                <tr className="border-t border-white/[0.12] bg-white/[0.02] font-semibold">
                  <th scope="row" className="px-3 py-3 text-left text-xs uppercase tracking-wide text-zinc-400">
                    Payroll total
                  </th>
                  <td colSpan={4} />
                  <td className="px-3 py-3 text-right text-base tabular-nums">{formatUsd(data.payrollTotal)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>

          <p className="text-sm text-zinc-400">
            {data.finalizedCount === data.rows.length
              ? `All ${pluralise(data.rows.length, 'agent')} finalised for ${formatMonthLabel(month)}.`
              : `${data.finalizedCount} of ${data.rows.length} finalised for ${formatMonthLabel(month)}` +
                (blocked.length > 0
                  ? ` · ${pluralise(blocked.length, 'agent')} ${blocked.length === 1 ? 'has' : 'have'} days with sales but no shift to fix first.`
                  : '.')}
          </p>

          <CloseMonthDialog
            key={closeKey}
            open={closeOpen}
            onOpenChange={setCloseOpen}
            month={month}
            ready={ready}
            blocked={blocked}
            onDone={() => void load()}
          />
        </>
      )}
    </div>
  );
}

function SortHeader({
  label,
  sortKey,
  sort,
  onSort,
  align = 'right',
}: {
  label: string;
  sortKey: SortKey;
  sort: { key: SortKey; desc: boolean };
  onSort: (next: { key: SortKey; desc: boolean }) => void;
  align?: 'left' | 'right';
}) {
  const active = sort.key === sortKey;
  return (
    // aria-sort belongs on the header cell, not the button inside it.
    <th
      scope="col"
      aria-sort={active ? (sort.desc ? 'descending' : 'ascending') : 'none'}
      className={cn('px-3 py-2.5', align === 'left' ? 'text-left' : 'text-right')}
    >
      <button
        type="button"
        // Names ascend first; money and hours descend first — the biggest
        // figure is the one payroll checks.
        onClick={() => onSort({ key: sortKey, desc: active ? !sort.desc : sortKey !== 'name' })}
        className={cn(
          'inline-flex items-center gap-1 rounded-sm hover:text-white focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
          HEAD,
        )}
      >
        {label}
        {active && (sort.desc ? <ArrowDown className="size-3" aria-hidden /> : <ArrowUp className="size-3" aria-hidden />)}
      </button>
    </th>
  );
}

/**
 * The roster row's second line. Each flag carries its meaning as visible or
 * screen-reader text, not only in a `title` — a tooltip on a span is reachable
 * by neither the keyboard nor a screen reader.
 */
function RowFlags({ row }: { row: RosterRow }) {
  return (
    <span className="mt-0.5 flex flex-wrap items-center gap-1.5">
      {row.tier && (
        <span className="text-xs tabular-nums text-zinc-400">
          {formatPercent(row.tier.currentPercent)}
          <span className="sr-only"> commission</span>
        </span>
      )}
      {row.status === 'finalized' && (
        <span className="inline-flex items-center gap-1 rounded-full bg-green-500/10 px-1.5 py-px text-[11px] font-medium text-green-400">
          <Lock className="size-2.5" aria-hidden />
          Finalised
        </span>
      )}
      {row.overriddenDays > 0 && (
        <span className="inline-flex items-center gap-1 rounded-full bg-action-blue/10 px-1.5 py-px text-[11px] font-medium text-blue-400">
          <Pencil className="size-2.5" aria-hidden />
          {row.overriddenDays}
          <span className="sr-only"> {row.overriddenDays === 1 ? 'day' : 'days'} edited by an administrator</span>
        </span>
      )}
      {row.missingShiftDays > 0 && (
        <span className="inline-flex items-center gap-1 rounded-full bg-orange-500/10 px-1.5 py-px text-[11px] font-medium text-orange-400">
          <TriangleAlert className="size-2.5" aria-hidden />
          {row.missingShiftDays} no shift
          <span className="sr-only"> — {row.missingShiftDays === 1 ? 'day' : 'days'} with sales but no shift on record</span>
        </span>
      )}
    </span>
  );
}

// ─── Close the month ─────────────────────────────────────────────────

function CloseMonthDialog({
  open,
  onOpenChange,
  month,
  ready,
  blocked,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  month: string;
  ready: RosterRow[];
  blocked: RosterRow[];
  onDone: () => void;
}) {
  const authFetch = useAuthFetch();
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [note, setNote] = useState('');
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [failures, setFailures] = useState<Array<{ name: string; message: string }>>([]);

  // Selection is derived against the rows on screen (DESIGN.md §5, the decision
  // queue): an agent who stopped being ready since the dialog last opened must
  // not be finalised by a stale tick.
  const included = ready.filter(r => !excluded.has(r.uid));
  const total = included.reduce((sum, r) => sum + (r.totals?.salary ?? 0), 0);
  const busy = progress !== null;

  async function run() {
    if (included.length === 0) return;
    const failed: Array<{ name: string; message: string }> = [];
    setFailures([]);
    setProgress({ done: 0, total: included.length });
    for (const [index, row] of included.entries()) {
      try {
        await authFetch('/api/ca-salary/finalize', {
          method: 'POST',
          body: JSON.stringify({ userId: row.uid, month, action: 'finalize', reason: note.trim() || undefined }),
        });
      } catch (err) {
        failed.push({
          name: row.displayName,
          message: err instanceof ApiError ? err.message : 'Could not reach the server',
        });
      }
      setProgress({ done: index + 1, total: included.length });
    }
    setProgress(null);
    onDone();

    const closed = included.length - failed.length;
    if (failed.length === 0) {
      toast.success(`${pluralise(closed, 'agent')} finalised for ${formatMonthLabel(month)}. Each has been told their pay is final.`);
      onOpenChange(false);
    } else {
      // Stay open on a partial failure: the dialog is where the names are.
      setFailures(failed);
      toast.error(`${pluralise(failed.length, 'agent')} not finalised`, {
        description: closed > 0 ? `${pluralise(closed, 'agent')} finalised.` : undefined,
      });
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={next => !busy && onOpenChange(next)}>
      <AlertDialogContent className="sm:max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle>Finalise {formatMonthLabel(month)}</AlertDialogTitle>
          <AlertDialogDescription>
            Each agent&apos;s month freezes at the figure shown. Later sales for them are refused, no figure can be
            edited, and each agent is notified that their pay is final.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <fieldset className="space-y-1" disabled={busy}>
          <legend className="mb-1.5 text-xs font-medium text-zinc-300">
            Ready — {pluralise(included.length, 'agent')}, <span className="tabular-nums">{formatUsd(total)}</span>
          </legend>
          <ul className="max-h-56 space-y-0.5 overflow-y-auto rounded-md border border-white/[0.07] p-1">
            {ready.map(row => {
              const checked = !excluded.has(row.uid);
              const id = `close-${row.uid}`;
              return (
                <li key={row.uid}>
                  <label
                    htmlFor={id}
                    className="flex cursor-pointer items-center gap-2.5 rounded px-2 py-1.5 text-sm hover:bg-white/[0.055]"
                  >
                    <Checkbox
                      id={id}
                      checked={checked}
                      className={SELECT_BOX_CLASS}
                      onCheckedChange={value =>
                        setExcluded(prev => {
                          const next = new Set(prev);
                          if (value === true) next.delete(row.uid);
                          else next.add(row.uid);
                          return next;
                        })
                      }
                    />
                    <span className="min-w-0 flex-1 truncate">{row.displayName}</span>
                    <span className="tabular-nums text-zinc-300">{formatUsd(row.totals?.salary ?? 0)}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        </fieldset>

        {blocked.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs font-medium text-zinc-300">Held back — fix these first</p>
            <ul className="space-y-0.5 text-sm text-zinc-400">
              {blocked.map(row => (
                <li key={row.uid} className="flex items-center gap-2">
                  <TriangleAlert className="size-3.5 shrink-0 text-orange-400" aria-hidden />
                  <span className="truncate text-zinc-300">{row.displayName}</span>
                  <span className="text-xs">
                    {pluralise(row.missingShiftDays, 'day')} with sales but no shift
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="close-month-note" className="text-xs">
            Note <span className="text-zinc-400">(optional, recorded on each month)</span>
          </Label>
          <Input
            id="close-month-note"
            value={note}
            onChange={event => setNote(event.target.value)}
            placeholder="Signed off by finance"
            className="h-8"
            disabled={busy}
          />
        </div>

        {failures.length > 0 && (
          <ul role="alert" className="space-y-0.5 text-sm text-red-400">
            {failures.map(f => (
              <li key={f.name}>
                {f.name}: {f.message}
              </li>
            ))}
          </ul>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <Button
            disabled={busy || included.length === 0}
            onClick={event => {
              event.preventDefault();
              void run();
            }}
          >
            {busy && <Loader2Icon className="activity-spinner size-3.5" aria-hidden />}
            {progress
              ? `Finalising ${Math.min(progress.done + 1, progress.total)} of ${progress.total}…`
              : `Finalise ${pluralise(included.length, 'agent')}`}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ─── One agent ───────────────────────────────────────────────────────

function AgentDetail({
  row,
  month,
  position,
  onPrevious,
  onNext,
  onBack,
}: {
  row: RosterRow;
  month: string;
  position: { index: number; count: number };
  onPrevious?: () => void;
  onNext?: () => void;
  onBack: () => void;
}) {
  const { data, loading, error, applyServerMonth, refetch } = useSalaryMonth(month, row.uid);
  const { timezone } = useViewerTimezone();

  const [inspectedDay, setInspectedDay] = useState<string | null>(null);
  const [tab, setTab] = useState('daily');

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <Button size="sm" variant="ghost" onClick={onBack} className="-ml-2 text-zinc-400">
          <ArrowLeft className="size-3.5" aria-hidden />
          All agents
        </Button>
        {/* In roster order, so closing the month is a walk down the list rather
            than a bounce through it. */}
        <div className="flex items-center gap-1 text-xs text-zinc-400">
          <span className="tabular-nums" aria-live="polite">
            {position.index + 1} of {position.count}
          </span>
          <Button size="icon-sm" variant="ghost" onClick={onPrevious} disabled={!onPrevious} aria-label="Previous agent">
            <ChevronLeft className="size-4" aria-hidden />
          </Button>
          <Button size="icon-sm" variant="ghost" onClick={onNext} disabled={!onNext} aria-label="Next agent">
            <ChevronRight className="size-4" aria-hidden />
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar className="size-10 shrink-0">
            <AvatarImage src={row.photoURL ?? undefined} alt="" />
            <AvatarFallback className="font-medium text-white" style={{ backgroundColor: getAvatarColor(row.displayName) }}>
              {getInitials(row.displayName)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold tracking-tight">{row.displayName}</h2>
            <p className="text-sm text-zinc-400">{formatMonthLabel(month)}</p>
          </div>
        </div>

        {data && <FinaliseControl userId={row.uid} month={month} status={data.status} onDone={refetch} data={data} />}
      </div>

      {loading && <Skeleton className="h-96 w-full rounded-lg" />}
      {error && !loading && <p className="text-sm text-red-400">{error}</p>}

      {data && !loading && (
        <>
          {data.status === 'finalized' && (
            <p className="flex items-center gap-2 rounded-lg border border-green-500/20 bg-green-500/[0.06] px-3 py-2 text-sm text-green-400">
              <Lock className="size-3.5 shrink-0" aria-hidden />
              <span>
                Finalised{data.finalizedByName ? ` by ${data.finalizedByName}` : ''} {formatRelative(data.finalizedAt)}.
                These figures are frozen — reopen the month to change anything.
              </span>
            </p>
          )}

          <section className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-4">
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-5">
              <Metric label="Gross" value={formatUsd(data.totals.grossEarnings)} />
              <Metric label="Commission" value={formatUsd(data.totals.commission)} />
              <Metric label="Hours" value={formatHours(data.totals.hours)} />
              <Metric label="Hourly pay" value={formatUsd(data.totals.wage)} />
              <Metric label="Salary" value={formatUsd(data.totals.salary)} emphasis />
            </dl>
            <div className="mt-4 border-t border-white/[0.07] pt-3">
              <CommissionLadder
                tier={data.tier}
                config={data.config}
                cumulativeGross={data.totals.grossEarnings}
              />
            </div>
          </section>

          <Tabs value={tab} onValueChange={setTab}>
            <TabsList>
              <TabsTrigger value="daily">Daily breakdown</TabsTrigger>
              <TabsTrigger value="sales">Sales report</TabsTrigger>
            </TabsList>

            <TabsContent value="daily" className="mt-4">
              <SalaryDayTable
                month={data}
                editable
                userId={row.uid}
                onMonthChange={applyServerMonth}
                onInspectDay={day => {
                  setInspectedDay(day);
                  setTab('sales');
                }}
              />
              <p className="mt-3 text-sm text-zinc-400">
                {data.status === 'finalized'
                  ? 'Reopen the month to edit these figures.'
                  : 'Select any figure to override it. Edits survive a re-import and can be reverted to the calculated value.'}
              </p>
            </TabsContent>

            <TabsContent value="sales" className="mt-4">
              <SalesReport
                month={month}
                userId={row.uid}
                timezone={timezone}
                day={inspectedDay}
                onClearDay={() => setInspectedDay(null)}
                onSelectDay={setInspectedDay}
                allowDelete={data.status !== 'finalized'}
                onDeleted={refetch}
              />
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}

function Metric({ label, value, emphasis }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-zinc-400">{label}</dt>
      <dd className={cn('mt-0.5 font-semibold tabular-nums', emphasis ? 'text-xl' : 'text-lg')}>{value}</dd>
    </div>
  );
}

// ─── Finalise / reopen ───────────────────────────────────────────────

/**
 * Finalising freezes a month for payout; reopening puts it back in play.
 *
 * Both confirm, and both state the consequence in the dialog rather than in a
 * tooltip: finalising stops late sales for that agent-month and tells the agent
 * their pay is final (`salaryFinalized`); reopening is silent, so the admin is
 * told to say so themselves. Neither touches leave any more (`leaveBalance.ts`).
 */
function FinaliseControl({
  userId,
  month,
  status,
  data,
  onDone,
}: {
  userId: string;
  month: string;
  status: 'open' | 'finalized';
  data: { totals: SalaryMonthTotals };
  onDone: () => void;
}) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const finalising = status === 'open';

  async function submit() {
    if (!user) return;
    setBusy(true);
    setError(null);
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/ca-salary/finalize', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          month,
          action: finalising ? 'finalize' : 'reopen',
          reason: reason.trim() || undefined,
        }),
      });

      if (!res.ok) {
        let message = `Could not ${finalising ? 'finalise' : 'reopen'} (${res.status})`;
        try {
          const body = await res.json();
          if (body?.error) message = body.error;
        } catch {
          /* keep the status-based message */
        }
        setError(message);
        return;
      }

      setOpen(false);
      setReason('');
      toast.success(finalising ? 'Month finalised. The agent has been told their pay is final.' : 'Month reopened.');
      onDone();
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button size="sm" variant={finalising ? 'default' : 'outline'} onClick={() => setOpen(true)}>
        {finalising ? <Lock className="size-3.5" aria-hidden /> : <LockOpen className="size-3.5" aria-hidden />}
        {finalising ? 'Finalise month' : 'Reopen month'}
      </Button>

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {finalising ? `Finalise ${formatMonthLabel(month)}?` : `Reopen ${formatMonthLabel(month)}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {finalising ? (
                <>
                  The month freezes at{' '}
                  <span className="font-semibold tabular-nums text-foreground">{formatUsd(data.totals.salary)}</span>.
                  Later sales for this agent and month will be refused and no figure can be edited. The agent is
                  notified that their pay is final.
                </>
              ) : (
                <>
                  Figures go back to being recalculated from sales and shifts. What was paid stays on record. The agent
                  is not notified automatically, so tell them their figures may change.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-1.5">
            <Label htmlFor="finalise-reason" className="text-xs">
              Note <span className="text-zinc-400">(optional)</span>
            </Label>
            <Input
              id="finalise-reason"
              value={reason}
              onChange={event => setReason(event.target.value)}
              placeholder={finalising ? 'Signed off by finance' : 'Late correction from the sales export'}
              className="h-8"
            />
          </div>

          {error && <p className="text-sm text-red-400">{error}</p>}

          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <Button
              disabled={busy}
              onClick={event => {
                event.preventDefault();
                void submit();
              }}
            >
              {busy && <Loader2Icon className="activity-spinner size-3.5" aria-hidden />}
              {finalising ? 'Finalise' : 'Reopen'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
