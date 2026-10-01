'use client';

import Link from 'next/link';
import { cn } from '@/lib/utils';
import { ArrowRight, Lock } from 'lucide-react';
import { formatRelative, formatUsd } from '@/lib/salary/salaryFormat';
import { formatMonthLabel } from '@/lib/salary/salaryDate';
import { SURFACE, SURFACE_INTERACTIVE } from '@/lib/surfaces';
import type { RecentlyFinalizedSalary } from '@/lib/salary/salaryTypes';

/**
 * "Last month is paid" — the dashboard's short-lived payout card.
 *
 * Once payroll finalises last month the salary card moves on to the current
 * one, and the figure the agent waited on would vanish the moment it became
 * real. This keeps it in view for a few days (`RECENTLY_FINALIZED_WINDOW_MS`,
 * decided server-side, so it disappears without a client deploy) and then gets
 * out of the way — it is news, not a fixture.
 *
 * Same shape as `SalarySummaryCard`: the whole card is the link, to the month's
 * own salary page.
 */
export function RecentPayoutCard({ payout, className }: { payout: RecentlyFinalizedSalary; className?: string }) {
  const label = formatMonthLabel(payout.month);

  return (
    <Link
      href={`/ca-portal/dashboard/salary?month=${payout.month}`}
      aria-label={`View finalised salary for ${label}`}
      className={cn('group block rounded-xl p-5', SURFACE, SURFACE_INTERACTIVE, className)}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">Salary · {label}</h2>
          <p className="mt-0.5 text-xs text-zinc-400">
            Finalised {formatRelative(payout.finalizedAt)} · scheduled for payout
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-full bg-green-500/10 px-2 py-0.5 text-[11px] font-medium text-green-400">
            <Lock className="size-3" aria-hidden />
            Finalised
          </span>
          <ArrowRight
            className="size-4 text-zinc-400 transition-transform duration-[120ms] group-hover:translate-x-0.5 group-hover:text-foreground"
            aria-hidden
          />
        </div>
      </div>

      <p className="mt-3 text-2xl font-semibold tabular-nums leading-none tracking-tight">
        {formatUsd(payout.salary)}
      </p>

      <dl className="mt-4 flex flex-wrap items-baseline gap-x-5 gap-y-1.5 border-t border-white/[0.07] pt-3">
        <div className="flex items-baseline gap-1.5">
          <dt className="text-xs text-zinc-400">Commission</dt>
          <dd className="text-sm font-medium tabular-nums">{formatUsd(payout.commission)}</dd>
        </div>
        <div className="flex items-baseline gap-1.5">
          <dt className="text-xs text-zinc-400">Hourly</dt>
          <dd className="text-sm font-medium tabular-nums">{formatUsd(payout.wage)}</dd>
        </div>
      </dl>
    </Link>
  );
}
