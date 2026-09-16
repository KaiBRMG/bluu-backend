'use client';

import Link from 'next/link';
import { cn } from '@/lib/utils';
import { ArrowRight, Lock, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { CommissionLadder } from './CommissionLadder';
import { useSalaryMonth } from '@/hooks/useSalaryMonth';
import { useBootPhase } from '@/contexts/BootLoaderContext';
import { formatHours, formatUsd } from '@/lib/salary/salaryFormat';
import { currentMonthKey, formatMonthLabel } from '@/lib/salary/salaryDate';
import { SURFACE, SURFACE_INTERACTIVE } from '@/lib/surfaces';

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
  // Defaults to the current, unfinalised month — which is what the dashboard
  // wants, and the only month a summary card should ever mean. It takes a month
  // anyway because it once had to: a picker governing the page had to govern this
  // card too, or August's roster could render above September's pay with both
  // labels correct and nothing saying the two scopes differed. The dashboard now
  // has no page-level scope at all (its schedule navigates itself), so nothing
  // passes one today — history lives on the salary page, which has its own picker.
  const month = monthProp ?? currentMonthKey();
  const { data, loading, error, refetch } = useSalaryMonth(month);

  // Async home widgets gate the boot screen so the dashboard does not paint
  // half-empty (CLAUDE.md rule 8).
  useBootPhase('ca-salary-summary', loading);

  if (loading) {
    return (
      <section className={cn('rounded-xl p-5', SURFACE)}>
        {/* Shaped to the real card, block for block. Stepping the month puts
            every card on this page back into its skeleton at once, and a
            skeleton shorter than what replaces it makes the whole page jump and
            drags the scroll position with it. */}
        <Skeleton className="h-4 w-40 rounded" />
        <Skeleton className="mt-2 h-3 w-52 rounded" />
        <Skeleton className="mt-3 h-8 w-44 rounded" />
        <Skeleton className="mt-4 h-4 w-full rounded" />
        <Skeleton className="mt-5 h-3 w-24 rounded" />
        <Skeleton className="mt-1.5 h-2 w-full rounded-full" />
        <Skeleton className="mt-2.5 h-4 w-64 rounded" />
      </section>
    );
  }

  if (error) {
    return (
      <section className={cn('rounded-xl p-5', SURFACE)}>
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
      // Without this the link's accessible name is computed from everything
      // inside it — heading, status line, the figure, four term/value pairs and
      // the ladder's own sentence — and announces as one forty-word link. The
      // card content stays readable on its own; only the link name is named.
      aria-label={`View salary details for ${formatMonthLabel(month)}`}
      className={cn('group block rounded-xl p-5', SURFACE, SURFACE_INTERACTIVE)}
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
