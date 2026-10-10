'use client';

import { useMemo } from 'react';
import { ChevronDown } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { formatDayLabel } from '@/lib/salary/salaryDate';
import { formatHours, formatPercent, formatUsd, pluralise } from '@/lib/salary/salaryFormat';
import { round2 } from '@/lib/salary/salaryEngine';
import type { SalaryDayResult, SalaryMonthResult, SalaryOverrideField } from '@/lib/salary/salaryTypes';

/**
 * "How this was calculated" — the agent's own month, worked through.
 *
 * The figure an agent most often reads as wrong is commission, because it is
 * **not** this month's rate × this month's net. The rate ratchets: each day
 * earns the rate the month-to-date gross had reached *that day* and keeps it,
 * so the days before a tier was crossed stay at the lower rate (ca-salary.md
 * §2). Nothing else on the page said so. This does, with their numbers.
 *
 * Built from the month result the page already holds — the engine's own
 * per-day figures, summed — so it cannot disagree with the headline: every
 * row here is a sum of days in the Daily breakdown, and the bottom line is
 * `totals.salary`. Days an administrator edited are counted where they land
 * and named, because an edited figure no longer follows from the rule above it.
 */

const COMMISSION_FIELDS: SalaryOverrideField[] = ['grossEarnings', 'commissionPercent', 'commission'];
const WAGE_FIELDS: SalaryOverrideField[] = ['hours', 'accountCount', 'hourlyRate', 'wage'];

interface CommissionBand {
  percent: number;
  first: string;
  last: string;
  days: number;
  net: number;
  commission: number;
  edited: number;
}

interface WageBand {
  rate: number;
  accounts: number;
  hours: number;
  wage: number;
}

function edited(day: SalaryDayResult, fields: SalaryOverrideField[]): boolean {
  return fields.some(f => day.overrides?.[f] !== undefined);
}

export function SalaryDerivation({ data }: { data: SalaryMonthResult }) {
  const derivation = useMemo(() => derive(data), [data]);
  const { commissionBands, wageBands, editedWage, salaryAdjustment, editedDays } = derivation;
  const { totals, config } = data;
  const keep = Math.round(100 - config.deductionRate * 100);

  return (
    <Collapsible className="mt-4 border-t border-white/[0.07] pt-3">
      <CollapsibleTrigger className="group flex w-full items-center justify-between gap-2 rounded-sm text-left text-sm font-medium text-zinc-200 hover:text-white focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
        How this was calculated
        <ChevronDown className="size-4 text-zinc-400 transition-transform duration-[120ms] group-data-[state=open]:rotate-180" aria-hidden />
      </CollapsibleTrigger>

      <CollapsibleContent className="mt-3 space-y-5 text-sm">
        <div>
          <h3 className="font-medium">Commission · {formatUsd(totals.commission)}</h3>
          <p className="mt-1 max-w-[70ch] text-zinc-400">
            Your commission rate is follows a tiered structure and is applied to your NET sales. Commission rates reset each month. The more sales you make, the higher your commission rate for the rest of the month. 
          </p>
          {commissionBands.length === 0 ? (
            <p className="mt-2 text-zinc-400">No sales this month yet.</p>
          ) : (
            <table className="mt-2 w-full border-collapse text-sm">
              <thead>
                <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
                  <th scope="col" className="py-1.5 pr-3 font-semibold">Rate</th>
                  <th scope="col" className="py-1.5 pr-3 font-semibold">Days</th>
                  <th scope="col" className="py-1.5 pr-3 text-right font-semibold">Net sales</th>
                  <th scope="col" className="py-1.5 text-right font-semibold">Commission</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.045]">
                {commissionBands.map(band => (
                  <tr key={`${band.percent}:${band.first}`}>
                    <th scope="row" className="py-1.5 pr-3 text-left font-medium tabular-nums">
                      {formatPercent(band.percent)}
                    </th>
                    <td className="py-1.5 pr-3 text-zinc-300">
                      {band.first === band.last ? formatDayLabel(band.first) : `${formatDayLabel(band.first)} – ${formatDayLabel(band.last)}`}
                      <span className="text-zinc-400">
                        {' · '}
                        {pluralise(band.days, 'day')} with sales
                        {band.edited > 0 && ` · ${band.edited} edited`}
                      </span>
                    </td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{formatUsd(band.net)}</td>
                    <td className="py-1.5 text-right tabular-nums">{formatUsd(band.commission)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div>
          <h3 className="font-medium">Hourly pay · {formatUsd(totals.wage)}</h3>
          <p className="mt-1 max-w-[70ch] text-zinc-400">
            Each shift pays per hour at the rate for the number of accounts assigned to you. Hours are your tracked time plus a{' '}
            {config.graceMinutes}-minute grace period. Your paid hours are capped at your shift time. 
          </p>
          {wageBands.length === 0 && editedWage.days === 0 ? (
            <p className="mt-2 text-zinc-400">No paid hours this month yet.</p>
          ) : (
            <table className="mt-2 w-full border-collapse text-sm">
              <thead>
                <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
                  <th scope="col" className="py-1.5 pr-3 font-semibold">Rate</th>
                  <th scope="col" className="py-1.5 pr-3 text-right font-semibold">Hours</th>
                  <th scope="col" className="py-1.5 text-right font-semibold">Pay</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.045]">
                {wageBands.map(band => (
                  <tr key={`${band.rate}:${band.accounts}`}>
                    <th scope="row" className="py-1.5 pr-3 text-left font-normal">
                      <span className="font-medium tabular-nums">{formatUsd(band.rate)}/h</span>
                      {band.accounts > 0 && <span className="text-zinc-400"> · {pluralise(band.accounts, 'account')}</span>}
                    </th>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{formatHours(band.hours)}</td>
                    <td className="py-1.5 text-right tabular-nums">{formatUsd(band.wage)}</td>
                  </tr>
                ))}
                {editedWage.days > 0 && (
                  <tr>
                    <th scope="row" className="py-1.5 pr-3 text-left font-normal text-zinc-300">
                      Set by an administrator
                      <span className="text-zinc-400"> · {pluralise(editedWage.days, 'day')}</span>
                    </th>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{formatHours(editedWage.hours)}</td>
                    <td className="py-1.5 text-right tabular-nums">{formatUsd(editedWage.wage)}</td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>

        <div className="border-t border-white/[0.07] pt-3">
          <p className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-zinc-400">
              {formatUsd(totals.commission)} commission + {formatUsd(totals.wage)} hourly pay
              {salaryAdjustment !== 0 && (
                <>
                  {' '}
                  {salaryAdjustment > 0 ? '+' : '−'} {formatUsd(Math.abs(salaryAdjustment))} set by an administrator
                </>
              )}
            </span>
            <span className="font-semibold tabular-nums">{formatUsd(totals.salary)}</span>
          </p>
          {editedDays.length > 0 && (
            <p className="mt-2 text-xs text-zinc-400">
              {pluralise(editedDays.length, 'day')} edited by an administrator (
              {editedDays.slice(0, 6).map(formatDayLabel).join(', ')}
              {editedDays.length > 6 && `, and ${editedDays.length - 6} more`}). The Daily breakdown marks each one with
              who changed it and why.
            </p>
          )}
          {data.status !== 'finalized' && (
            <p className="mt-2 text-xs text-zinc-400">
              Until payroll finalises the month, these figures update as sales sync and shifts are recorded.
            </p>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function derive(data: SalaryMonthResult) {
  const commissionBands: CommissionBand[] = [];
  const wageMap = new Map<string, WageBand>();
  const editedWage = { days: 0, hours: 0, wage: 0 };
  const editedDays: string[] = [];
  let commissionSum = 0;
  let wageSum = 0;
  // Under the `per-day` basis a shift's rate comes from the whole day's
  // accounts, so its own count would mislabel the rate; group by rate alone.
  const perDay = data.config.wageRateBasis === 'per-day';

  for (const day of data.days) {
    if (day.overrides && Object.keys(day.overrides).length > 0) editedDays.push(day.day);

    // Commission: consecutive days at one rate form a band — the ratchet only
    // moves up, so a band is a run of the calendar.
    commissionSum += day.commission;
    if (day.saleCount > 0 || day.netEarnings !== 0 || day.commission !== 0) {
      const last = commissionBands[commissionBands.length - 1];
      if (last && last.percent === day.commissionPercent) {
        last.last = day.day;
        last.days += 1;
        last.net += day.netEarnings;
        last.commission += day.commission;
        if (edited(day, COMMISSION_FIELDS)) last.edited += 1;
      } else {
        commissionBands.push({
          percent: day.commissionPercent,
          first: day.day,
          last: day.day,
          days: 1,
          net: day.netEarnings,
          commission: day.commission,
          edited: edited(day, COMMISSION_FIELDS) ? 1 : 0,
        });
      }
    }

    // Hourly: per shift, grouped by the rate it paid — unless the day's pay was
    // edited, in which case the shifts no longer explain it.
    wageSum += day.wage;
    if (edited(day, WAGE_FIELDS)) {
      if (day.wage !== 0 || day.hours !== 0) {
        editedWage.days += 1;
        editedWage.hours += day.hours;
        editedWage.wage += day.wage;
      }
      continue;
    }
    for (const shift of day.shifts) {
      if (!shift.paysWage || shift.wage === 0) continue;
      const key = perDay ? `${shift.hourlyRate}` : `${shift.hourlyRate}:${shift.accountCount}`;
      const band = wageMap.get(key) ?? { rate: shift.hourlyRate, accounts: perDay ? 0 : shift.accountCount, hours: 0, wage: 0 };
      band.hours += shift.payableHours;
      band.wage += shift.wage;
      wageMap.set(key, band);
    }
  }

  const wageBands = [...wageMap.values()].sort((a, b) => a.rate - b.rate);
  // A salary override (or rounding across days) is the gap between the parts and the whole.
  const gap = round2(data.totals.salary - commissionSum - wageSum);
  return { commissionBands, wageBands, editedWage, salaryAdjustment: Math.abs(gap) >= 0.01 ? gap : 0, editedDays };
}
