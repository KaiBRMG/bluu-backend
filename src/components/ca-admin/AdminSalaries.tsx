'use client';

import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, ChevronRight, Loader2Icon, Lock, LockOpen, Pencil, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
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
import { SalaryDayTable } from '@/components/salary/SalaryDayTable';
import { SalesReport } from '@/components/salary/SalesReport';
import { CommissionLadder } from '@/components/salary/CommissionLadder';
import { useAuth } from '@/components/AuthProvider';
import { useSalaryMonth } from '@/hooks/useSalaryMonth';
import { getAvatarColor, getInitials } from '@/lib/utils/avatar';
import { formatMonthLabel } from '@/lib/salary/salaryDate';
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
 * mismatch that gets a figure quoted from the wrong month.
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

export default function AdminSalaries({
  month,
  onMonthChange,
}: {
  month: string;
  onMonthChange: (month: string) => void;
}) {
  const [selected, setSelected] = useState<RosterRow | null>(null);

  const { user } = useAuth();
  const [data, setData] = useState<RosterResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
      setData((await res.json()) as RosterResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load payroll');
    } finally {
      setLoading(false);
    }
  }, [user, month]);

  useEffect(() => {
    void load();
  }, [load]);

  if (selected) {
    return (
      <AgentDetail
        row={selected}
        month={month}
        onBack={() => {
          setSelected(null);
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
        <MonthPicker month={month} onChange={onMonthChange} />
      </div>

      {loading && <Skeleton className="h-80 w-full rounded-lg" />}
      {error && !loading && <p className="text-sm text-red-400">{error}</p>}

      {data && !loading && data.rows.length === 0 && (
        <p className="text-sm text-zinc-400">
          No chat agents found. Add users to the CA group in User Management to see them here.
        </p>
      )}

      {data && !loading && data.rows.length > 0 && (
        <>
          <div className="overflow-x-auto rounded-lg border border-white/[0.07]">
            <table className="w-full min-w-[760px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-white/[0.07]">
                  <th scope="col" className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
                    Agent
                  </th>
                  {['Gross', 'Commission', 'Hours', 'Hourly pay', 'Salary'].map(label => (
                    <th
                      key={label}
                      scope="col"
                      className="px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-zinc-400"
                    >
                      {label}
                    </th>
                  ))}
                  <th scope="col" className="w-10 px-3 py-2.5" />
                </tr>
              </thead>

              <tbody className="divide-y divide-white/[0.045]">
                {data.rows.map(row => (
                  <tr
                    key={row.uid}
                    className="group transition-colors duration-[120ms] hover:bg-white/[0.055] focus-within:bg-white/[0.055]"
                  >
                    <td className="px-3 py-2.5">
                      <button
                        type="button"
                        onClick={() => setSelected(row)}
                        aria-label={`Open ${row.displayName}'s ${formatMonthLabel(month)} salary`}
                        className="flex w-full items-center gap-2.5 rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3b82f6]"
                      >
                        <Avatar className="size-7 shrink-0">
                          <AvatarImage src={row.photoURL ?? undefined} alt="" />
                          <AvatarFallback className="font-medium text-white" style={{ backgroundColor: getAvatarColor(row.displayName) }}>
                            {getInitials(row.displayName)}
                          </AvatarFallback>
                        </Avatar>
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{row.displayName}</span>
                          <span className="mt-0.5 flex flex-wrap items-center gap-1.5">
                            {row.tier && (
                              <span className="text-xs tabular-nums text-zinc-400">
                                {formatPercent(row.tier.currentPercent)}
                              </span>
                            )}
                            {row.status === 'finalized' && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-green-500/10 px-1.5 py-px text-[10px] font-medium text-green-400">
                                <Lock className="size-2.5" aria-hidden />
                                Finalised
                              </span>
                            )}
                            {row.overriddenDays > 0 && (
                              <span
                                className="inline-flex items-center gap-1 rounded-full bg-[#3b82f6]/10 px-1.5 py-px text-[10px] font-medium text-[#3b82f6]"
                                title={`${pluralise(row.overriddenDays, 'day')} edited by an administrator`}
                              >
                                <Pencil className="size-2.5" aria-hidden />
                                {row.overriddenDays}
                              </span>
                            )}
                            {row.missingShiftDays > 0 && (
                              <span
                                className="inline-flex items-center gap-1 rounded-full bg-orange-500/10 px-1.5 py-px text-[10px] font-medium text-orange-400"
                                title={`${pluralise(row.missingShiftDays, 'day')} with sales but no shift on record`}
                              >
                                <TriangleAlert className="size-2.5" aria-hidden />
                                {row.missingShiftDays}
                              </span>
                            )}
                          </span>
                        </span>
                      </button>
                    </td>

                    <td className="px-3 py-2.5 text-right tabular-nums">{formatUsd(row.totals?.grossEarnings ?? 0)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{formatUsd(row.totals?.commission ?? 0)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{formatHours(row.totals?.hours ?? 0)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{formatUsd(row.totals?.wage ?? 0)}</td>
                    <td className="px-3 py-2.5 text-right font-medium tabular-nums">{formatUsd(row.totals?.salary ?? 0)}</td>
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
              : `${data.finalizedCount} of ${data.rows.length} finalised for ${formatMonthLabel(month)}.`}
          </p>
        </>
      )}
    </div>
  );
}

// ─── One agent ───────────────────────────────────────────────────────

function AgentDetail({ row, month, onBack }: { row: RosterRow; month: string; onBack: () => void }) {
  const { data, loading, error, applyServerMonth, refetch } = useSalaryMonth(month, row.uid);
  const { timezone } = useViewerTimezone();

  const [inspectedDay, setInspectedDay] = useState<string | null>(null);
  const [tab, setTab] = useState('daily');

  return (
    <div className="space-y-4">
      <Button size="sm" variant="ghost" onClick={onBack} className="-ml-2 text-zinc-400">
        <ArrowLeft className="size-3.5" aria-hidden />
        All agents
      </Button>

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
 * tooltip: finalising stops late sales imports for that agent-month, and
 * reopening tells the agent their figures may change. These are the two actions
 * in the subsystem that a person downstream will notice.
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
      toast.success(finalising ? 'Month finalised' : 'Month reopened');
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
                  Further sales imports for this agent and month will be refused and no figure can be edited. The agent
                  is not notified automatically — let them know yourself.
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
              Note <span className="text-zinc-500">(optional)</span>
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
