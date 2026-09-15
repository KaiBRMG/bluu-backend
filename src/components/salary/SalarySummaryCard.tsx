'use client';

import Link from 'next/link';
import { ArrowRight, Lock, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { CommissionLadder } from './CommissionLadder';
import { useSalaryMonth } from '@/hooks/useSalaryMonth';
import { useBootPhase } from '@/contexts/BootLoaderContext';
import { formatHours, formatUsd } from '@/lib/salary/salaryFormat';
import { currentMonthKey, formatMonthLabel } from '@/lib/salary/salaryDate';

/**
 * The salary section on the chat-agent dashboard.
 *
 * Answers three questions in the order they are asked: what am I earning this
 * month, where did it come from, and what would move it. The salary figure is
 * the only Display-step number on the card — gross, hours and the rate are the
 * evidence behind it, not competing headlines.
 *
 * The whole card is the link. There is nothing else interactive inside it, so
 * making the container the control is the honest shape (DESIGN.md §5, the metric
 * roster) and gives a much larger target than a "View details" link would.
 */

export function SalarySummaryCard({ month: monthProp }: { month?: string } = {}) {
  // The dashboard's month picker governs the page, this card included. Pinning it
  // to the current month while a picker sat below it meant August's roster could
  // render above September's pay, with both labels correct and nothing saying the
  // two scopes differed.
  const month = monthProp ?? currentMonthKey();
  const { data, loading, error, refetch } = useSalaryMonth(month);

  // Async home widgets gate the boot screen so the dashboard does not paint
  // half-empty (CLAUDE.md rule 8).
  useBootPhase('ca-salary-summary', loading);

  if (loading) {
    return (
      <section className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-5">
        <Skeleton className="h-4 w-40 rounded" />
        <Skeleton className="mt-3 h-9 w-44 rounded" />
        <Skeleton className="mt-5 h-2 w-full rounded-full" />
        <Skeleton className="mt-3 h-4 w-64 rounded" />
      </section>
    );
  }

  if (error) {
    return (
      <section className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-5">
        <h2 className="text-sm font-semibold">Salary</h2>
        <p className="mt-2 text-sm text-red-400">{error}</p>
        {/* A sentence with no verb is not a recovery. The Electron window has no
            reload button, so the retry has to live here. */}
        <Button size="sm" variant="outline" className="mt-3" onClick={() => void refetch()}>
          <RotateCcw className="size-3.5" aria-hidden />
          Try again
        </Button>
      </section>
    );
  }

  if (!data) return null;

  const { totals, tier, config, status } = data;
  const isFinalized = status === 'finalized';
  const isCurrentMonth = month === currentMonthKey();

  return (
    <Link
      href={`/ca-portal/dashboard/salary?month=${month}`}
      className="group block rounded-xl border border-white/[0.07] bg-white/[0.025] p-5 transition-colors duration-[120ms] hover:bg-white/[0.055] active:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#3b82f6]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">Salary · {formatMonthLabel(month)}</h2>
          {/* "So far this month" is only true of the current month — now that the
              picker governs this card, each of the three states says its own
              thing. */}
          <p className="mt-0.5 text-xs text-zinc-400">
            {isFinalized
              ? 'Finalised and scheduled for payout'
              : isCurrentMonth
                ? 'So far this month · paid on the 1st'
                : 'Payout Processed'}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {isFinalized && (
            <span className="inline-flex items-center gap-1 rounded-full bg-green-500/10 px-2 py-0.5 text-[11px] font-medium text-green-400">
              <Lock className="size-3" aria-hidden />
              Finalised
            </span>
          )}
          <ArrowRight
            className="size-4 text-zinc-400 transition-transform duration-[120ms] group-hover:translate-x-0.5 group-hover:text-foreground"
            aria-hidden
          />
        </div>
      </div>

      {/* Primary. Everything else on the card explains this number. */}
      <p className="mt-3 text-3xl font-semibold tabular-nums leading-none tracking-tight">
        {formatUsd(totals.salary)}
      </p>

      {/* Secondary: where it came from. A hairline-separated row rather than
          three nested cards — nested cards are always wrong (craft floor). */}
      <dl className="mt-4 flex flex-wrap items-baseline gap-x-5 gap-y-1.5 border-t border-white/[0.07] pt-3">
        <div className="flex items-baseline gap-1.5">
          <dt className="text-xs text-zinc-400">Gross sales</dt>
          <dd className="text-sm font-medium tabular-nums">{formatUsd(totals.grossEarnings)}</dd>
        </div>
        <div className="flex items-baseline gap-1.5">
          <dt className="text-xs text-zinc-400">Commission</dt>
          <dd className="text-sm font-medium tabular-nums">{formatUsd(totals.commission)}</dd>
        </div>
        <div className="flex items-baseline gap-1.5">
          <dt className="text-xs text-zinc-400">Hourly</dt>
          <dd className="text-sm font-medium tabular-nums">{formatUsd(totals.wage)}</dd>
        </div>
        <div className="flex items-baseline gap-1.5">
          <dt className="text-xs text-zinc-400">Hours</dt>
          <dd className="text-sm font-medium tabular-nums">{formatHours(totals.hours)}</dd>
        </div>
      </dl>

      <div className="mt-4">
        <CommissionLadder
          tier={tier}
          config={config}
          cumulativeGross={totals.grossEarnings}
          variant="compact"
        />
      </div>
    </Link>
  );
}
