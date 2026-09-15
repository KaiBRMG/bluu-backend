'use client';

import { Suspense, useCallback, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, Lock, RotateCcw } from 'lucide-react';
import AppLayout from '@/components/AppLayout';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { CommissionLadder } from '@/components/salary/CommissionLadder';
import { SalaryDayTable } from '@/components/salary/SalaryDayTable';
import { SalesReport } from '@/components/salary/SalesReport';
import { MonthPicker } from '@/components/salary/MonthPicker';
import { useSalaryMonth } from '@/hooks/useSalaryMonth';
import { currentMonthKey, formatMonthLabel, isMonthKey } from '@/lib/salary/salaryDate';
import { formatHours, formatUsd, pluralise, signedMoneyClass } from '@/lib/salary/salaryFormat';
import type { SalaryMonthResult } from '@/lib/salary/salaryTypes';
import { useViewerTimezone } from '@/hooks/useViewerTimezone';
import { useSalaryEarliestMonth } from '@/hooks/useSalaryEarliestMonth';

/**
 * `/ca-portal/dashboard/salary` — the agent's own salary, in detail.
 *
 * A real route rather than a panel on the dashboard: the back button works, a
 * notification can point at it, and the dashboard does not pay for this code on
 * every load. It still renders inside the app shell, so it reads as part of the
 * dashboard rather than somewhere else.
 *
 * Three tabs, in the order the questions arrive: how am I doing, what did each
 * day pay, and which sales made it up.
 *
 * ## The month lives in the URL
 *
 * It was component state, which quietly broke the reason above for this being a
 * route at all — nothing could point at a *month*. Nobody is notified when a
 * month is finalised (ca-salary.md §11); an admin tells each agent by hand, and
 * they could not paste a link to the month in question. `?month=YYYY-MM` fixes
 * that and costs nothing: an unparseable value falls back to the current month
 * rather than erroring.
 */

export default function SalaryPage() {
  return (
    <AppLayout>
      {/* `useSearchParams` suspends, and the fallback is the same skeleton the
          month itself loads behind — so the boundary is invisible in practice. */}
      <Suspense
        fallback={
          <div className="max-w-5xl">
            <PageSkeleton />
          </div>
        }
      >
        <SalaryPageContent />
      </Suspense>
    </AppLayout>
  );
}

function SalaryPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // A future month has no data by definition, so a hand-edited or stale link to
  // one falls back rather than rendering an empty month as if it were real.
  const requested = searchParams.get('month');
  const month =
    requested && isMonthKey(requested) && requested <= currentMonthKey() ? requested : currentMonthKey();

  const setMonth = useCallback(
    (next: string) => {
      // `replace`, not `push`: stepping through six months should not mean six
      // presses of Back to leave the page.
      router.replace(`/ca-portal/dashboard/salary?month=${next}`, { scroll: false });
    },
    [router],
  );

  const [inspectedDay, setInspectedDay] = useState<string | null>(null);
  const [tab, setTab] = useState('overview');
  const salesTabRef = useRef<HTMLButtonElement>(null);

  const { data, loading, error, refetch } = useSalaryMonth(month);
  const { timezone } = useViewerTimezone();
  const earliest = useSalaryEarliestMonth();

  return (
    <div className="max-w-5xl">
      <Link
        href="/ca-portal/dashboard"
        className="inline-flex items-center gap-1.5 rounded-sm text-sm text-zinc-400 transition-colors duration-[120ms] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3b82f6]"
      >
        <ArrowLeft className="size-3.5" aria-hidden />
        Dashboard
      </Link>

      <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight">My Salary</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Commission on your sales plus your hourly pay. Paid on the 1st of each month.
          </p>
        </div>
        <MonthPicker month={month} onChange={setMonth} earliest={earliest} />
      </div>

      {loading && <PageSkeleton />}

      {error && !loading && (
        <div className="mt-8 space-y-3">
          <p className="text-sm text-red-400">{error}</p>
          {/* The Electron window has no reload button, and this is the screen
              people open when they are already anxious about a number. */}
          <Button size="sm" variant="outline" onClick={() => void refetch()}>
            <RotateCcw className="size-3.5" aria-hidden />
            Try again
          </Button>
        </div>
      )}

      {data && !loading && (
        <>
          {data.status === 'finalized' && (
            <p className="mt-5 flex items-center gap-2 rounded-lg border border-green-500/20 bg-green-500/[0.06] px-3 py-2 text-sm text-green-400">
              <Lock className="size-3.5 shrink-0" aria-hidden />
              <span>
                {formatMonthLabel(month)} is finalised
                {data.finalizedByName ? ` by ${data.finalizedByName}` : ''} and scheduled for payout. These figures
                will not change.
              </span>
            </p>
          )}

          <Tabs value={tab} onValueChange={setTab} className="mt-6">
            <TabsList>
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="daily">Daily breakdown</TabsTrigger>
              <TabsTrigger value="sales" ref={salesTabRef}>
                Sales report
              </TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="mt-5">
              <Overview month={month} data={data} />
            </TabsContent>

            <TabsContent value="daily" className="mt-5">
              <SalaryDayTable
                month={data}
                onInspectDay={day => {
                  setInspectedDay(day);
                  setTab('sales');
                  // The date button lives inside this panel, so switching tabs
                  // unmounts the control that was just activated and focus falls
                  // to <body>. Hand it to the tab the user is being taken to.
                  requestAnimationFrame(() => salesTabRef.current?.focus());
                }}
              />
              <p className="mt-3 text-sm text-zinc-400">
                Hours come from your tracked shift time, plus a {data.config.graceMinutes}-minute grace period, capped
                at the length of the shift. Select a date to see the sales behind it.
              </p>
            </TabsContent>

            <TabsContent value="sales" className="mt-5">
              <SalesReport
                month={month}
                timezone={timezone}
                day={inspectedDay}
                onClearDay={() => setInspectedDay(null)}
              />
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}

// ─── Overview ────────────────────────────────────────────────────────

function Overview({ month, data }: { month: string; data: SalaryMonthResult }) {
  const { totals, tier, config } = data;

  // The month's best day is the one piece of encouragement the data supports
  // honestly — it is a fact about their work, not a manufactured streak.
  const bestDay = [...data.days].sort((a, b) => b.grossEarnings - a.grossEarnings)[0];

  return (
    <div className="space-y-5">
      {/* The headline and the ladder together: the figure, then the one thing
          that would move it. */}
      <section className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-5">
        <h2 className="text-sm font-semibold">{formatMonthLabel(month)} so far</h2>
        {/* The Earnings step (DESIGN.md §3) — the same size this figure carries on
            the dashboard card, deliberately, because it is the same number. */}
        <p className="mt-2 text-3xl font-semibold tabular-nums leading-none tracking-tight">
          {formatUsd(totals.salary)}
        </p>
        <p className="mt-2 text-sm text-zinc-400">
          {formatUsd(totals.commission)} commission + {formatUsd(totals.wage)} hourly pay
        </p>

        <div className="mt-5 border-t border-white/[0.07] pt-4">
          <CommissionLadder tier={tier} config={config} cumulativeGross={totals.grossEarnings} />
        </div>
      </section>

      {/* Evidence. A plain definition grid rather than a row of identical cards —
          same-size cards as page structure is the lazy container. */}
      <section className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-5">
        <h2 className="text-sm font-semibold">This month</h2>
        <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
          {/* Signed, like the same figure in the day table. A month whose reversals
              exceed its sales is legal, and it rendered white here and red there. */}
          <Metric
            label="Gross Earnings"
            value={formatUsd(totals.grossEarnings)}
            className={signedMoneyClass(totals.grossEarnings)}
          />
          <Metric
            label="NET Earnings"
            value={formatUsd(totals.netEarnings)}
            hint={`${Math.round(100 - config.deductionRate * 100)}%`}
          />
          <Metric label="Hours worked" value={formatHours(totals.hours)} />
          <Metric label="Days worked" value={String(totals.daysWorked)} />
        </dl>

        <p className="mt-4 border-t border-white/[0.07] pt-3 text-sm text-zinc-400">
          {totals.saleCount > 0 ? (
            <>
              {pluralise(totals.saleCount, 'sale')} recorded
              {bestDay && bestDay.grossEarnings > 0 && (
                <>
                  {' · '}best day{' '}
                  <span className="tabular-nums text-foreground">{formatUsd(bestDay.grossEarnings)}</span>
                </>
              )}
            </>
          ) : (
            'No sales have been imported for this month yet.'
          )}
        </p>
      </section>
    </div>
  );
}

function Metric({
  label,
  value,
  hint,
  className,
}: {
  label: string;
  value: string;
  hint?: string;
  className?: string;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-zinc-400">{label}</dt>
      <dd className={cn('mt-0.5 text-xl font-semibold tabular-nums', className)}>{value}</dd>
      {hint && <p className="mt-0.5 text-xs text-zinc-400">{hint}</p>}
    </div>
  );
}

function PageSkeleton() {
  return (
    <div className="mt-6 space-y-5">
      <Skeleton className="h-9 w-72 rounded-md" />
      <Skeleton className="h-56 w-full rounded-xl" />
      <Skeleton className="h-40 w-full rounded-xl" />
    </div>
  );
}
