'use client';

import { useState } from 'react';
import { AlertTriangle, Pencil, StickyNote } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { SalaryCellEditor } from './SalaryCellEditor';
import { formatDayLabelWithWeekday, currentDayKey } from '@/lib/salary/salaryDate';
import { formatHours, formatPercent, formatUsd, signedMoneyClass } from '@/lib/salary/salaryFormat';
import type { SalaryDayResult, SalaryMonthResult, SalaryOverrideField } from '@/lib/salary/salaryTypes';

/**
 * The month grid — one row per calendar day, exactly like the sheet it replaces.
 *
 * The same component serves the agent (read-only) and payroll (`editable`).
 * Two components for one table is how the two drift apart, and this is a table
 * where a drift means an agent and an admin reading different numbers.
 *
 * ## Why every day is a row
 *
 * Days with no activity still render. The spreadsheet had a row per date and
 * people read down it by date; collapsing empty days would make the 14th sit
 * where the 11th should be, and "did I not work, or is the data missing" is
 * exactly the question this table exists to answer. Empty rows are dimmed, not
 * absent.
 *
 * ## The two marks
 *
 * A **pencil** means an admin replaced that figure; its tooltip carries who,
 * when, why, and what the system had computed. An **amber triangle** on the row
 * means sales landed on a day with no shift on record — the hours (and so the
 * wage) could not be derived, which is a data problem, not a zero.
 */

interface SalaryDayTableProps {
  month: SalaryMonthResult;
  editable?: boolean;
  /** Required when `editable` — the agent whose days these are. */
  userId?: string;
  onMonthChange?: (next: SalaryMonthResult) => void;
  /** Opens the day's individual sales. */
  onInspectDay?: (day: string) => void;
}

/** Declared once so the tooltip and its screen-reader text cannot drift apart. */
const MISSING_SHIFT_EXPLANATION =
  'Sales landed on this day but no shift is on record, so hours and hourly pay could not be worked out.';

const COLUMNS: Array<{ key: string; label: string; field?: SalaryOverrideField; hint?: string }> = [
  { key: 'day', label: 'Date' },
  { key: 'gross', label: 'Gross', field: 'grossEarnings', hint: 'Total sales for the day, reversals deducted.' },
  { key: 'net', label: 'Net', hint: 'Gross less the platform deduction.' },
  { key: 'pct', label: 'Rate', field: 'commissionPercent', hint: 'Commission rate earned on this day.' },
  { key: 'commission', label: 'Commission', field: 'commission' },
  { key: 'hours', label: 'Hours', field: 'hours', hint: 'Tracked time plus the grace period, capped at the shift length.' },
  { key: 'accounts', label: 'Accts', field: 'accountCount', hint: 'Creator accounts worked — sets the hourly rate.' },
  { key: 'rate', label: '$/hr', field: 'hourlyRate' },
  { key: 'wage', label: 'Hourly pay', field: 'wage' },
  { key: 'salary', label: 'Salary', field: 'salary' },
];

export function SalaryDayTable({
  month,
  editable = false,
  userId,
  onMonthChange,
  onInspectDay,
}: SalaryDayTableProps) {
  const [openCell, setOpenCell] = useState<string | null>(null);
  const today = currentDayKey();
  const locked = month.status === 'finalized';
  const canEdit = editable && !locked && !!userId;

  return (
    // Focusable and named. A horizontally scrolling region that only responds to
    // a pointer is a WCAG 2.1.1 failure, and it bites hardest here: at the 1024px
    // Electron window floor the content column is ~704px, so the rightmost column
    // — Salary, the number this table exists to show — started off-screen. The
    // minimum width came down from 820px and the numeric columns gave up a little
    // horizontal padding, which closes most of that gap; the rest is now
    // reachable from the keyboard.
    <div
      tabIndex={0}
      role="region"
      aria-label="Daily salary breakdown, scrollable"
      className="overflow-x-auto rounded-lg border border-white/[0.07] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/50"
    >
      <table className="w-full min-w-[720px] border-collapse text-sm">
        <caption className="sr-only">
          Daily salary breakdown. Each row is one calendar day; figures marked as edited were set by an administrator.
        </caption>
        <thead>
          <tr className="border-b border-white/[0.07]">
            {COLUMNS.map(column => (
              <th
                key={column.key}
                scope="col"
                className={cn(
                  'whitespace-nowrap py-2.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400',
                  column.key === 'day' ? 'px-3 text-left' : 'px-2.5 text-right',
                )}
              >
                {column.hint ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      {/* `asChild` forwards props but adds no tabIndex, so without
                          this the definition of every column is reachable by
                          mouse only. */}
                      <span
                        tabIndex={0}
                        className="cursor-help rounded-sm border-b border-dotted border-white/20 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                      >
                        {column.label}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-56 text-center leading-relaxed">{column.hint}</TooltipContent>
                  </Tooltip>
                ) : (
                  column.label
                )}
              </th>
            ))}
          </tr>
        </thead>

        <tbody className="divide-y divide-white/[0.045]">
          {month.days.map(day => (
            <DayRow
              key={day.day}
              day={day}
              isToday={day.day === today}
              canEdit={canEdit}
              userId={userId}
              openCell={openCell}
              setOpenCell={setOpenCell}
              onMonthChange={onMonthChange}
              onInspectDay={onInspectDay}
            />
          ))}
        </tbody>

        <tfoot>
          <tr className="border-t border-white/[0.12] bg-white/[0.02] font-semibold">
            <th scope="row" className="px-3 py-3 text-left text-xs uppercase tracking-wide text-zinc-400">
              Total
            </th>
            <td className={cn('px-2.5 py-3 text-right tabular-nums', signedMoneyClass(month.totals.grossEarnings))}>
              {formatUsd(month.totals.grossEarnings)}
            </td>
            <td className="px-2.5 py-3 text-right tabular-nums">{formatUsd(month.totals.netEarnings)}</td>
            <td className="px-2.5 py-3 text-right text-zinc-400">—</td>
            <td className="px-2.5 py-3 text-right tabular-nums">{formatUsd(month.totals.commission)}</td>
            <td className="px-2.5 py-3 text-right tabular-nums">{formatHours(month.totals.hours)}</td>
            <td className="px-2.5 py-3 text-right text-zinc-400">—</td>
            <td className="px-2.5 py-3 text-right text-zinc-400">—</td>
            <td className="px-2.5 py-3 text-right tabular-nums">{formatUsd(month.totals.wage)}</td>
            <td className="px-2.5 py-3 text-right tabular-nums">{formatUsd(month.totals.salary)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

// ─── Row ─────────────────────────────────────────────────────────────

function DayRow({
  day,
  isToday,
  canEdit,
  userId,
  openCell,
  setOpenCell,
  onMonthChange,
  onInspectDay,
}: {
  day: SalaryDayResult;
  isToday: boolean;
  canEdit: boolean;
  userId?: string;
  openCell: string | null;
  setOpenCell: (key: string | null) => void;
  onMonthChange?: (next: SalaryMonthResult) => void;
  onInspectDay?: (day: string) => void;
}) {
  const isEmpty = day.saleCount === 0 && day.hours === 0 && Object.keys(day.overrides).length === 0;

  const cell = (
    key: string,
    field: SalaryOverrideField | undefined,
    display: string,
    rawValue: number,
    className?: string,
  ) => {
    const override = field ? day.overrides[field] : undefined;
    const cellKey = `${day.day}:${key}`;

    // No blue ink on an overridden figure. Action Blue already means "today" two
    // rows down and "magnitude" in the sales report, and at 14px on the canvas it
    // measures ~4.3:1 — under the AA floor for the one number most likely to be
    // disputed. The pencil carries the signal instead, in both modes.
    const content = <span className={cn('tabular-nums', className)}>{display}</span>;

    if (!canEdit || !field || !userId) {
      return (
        <td className="whitespace-nowrap px-2.5 py-2 text-right">
          {override ? (
            <Tooltip>
              <TooltipTrigger asChild>
                {/* Who changed this figure on someone's pay is not supplementary,
                    so it is announced unconditionally rather than left to a hover
                    a keyboard cannot perform. The tooltip is now reinforcement. */}
                <span
                  tabIndex={0}
                  className="inline-flex cursor-help items-center gap-1 rounded-sm focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  {content}
                  <Pencil className="size-3 text-action-blue" aria-hidden />
                  <span className="sr-only">
                    <OverrideExplanation override={override} />
                  </span>
                </span>
              </TooltipTrigger>
              <TooltipContent className="max-w-64 leading-relaxed">
                <OverrideExplanation override={override} />
              </TooltipContent>
            </Tooltip>
          ) : (
            content
          )}
        </td>
      );
    }

    return (
      <td className="whitespace-nowrap px-1 py-1 text-right">
        <SalaryCellEditor
          open={openCell === cellKey}
          onOpenChange={next => setOpenCell(next ? cellKey : null)}
          userId={userId}
          day={day.day}
          field={field}
          label={key}
          currentValue={rawValue}
          computedValue={override?.computed ?? rawValue}
          override={override}
          onApplied={next => {
            setOpenCell(null);
            onMonthChange?.(next);
          }}
        >
          {content}
        </SalaryCellEditor>
      </td>
    );
  };

  return (
    <tr className={cn(isEmpty && 'text-zinc-400', isToday && 'bg-action-blue/[0.06]')}>
      <th scope="row" className="whitespace-nowrap px-3 py-2 text-left font-normal">
        <span className="inline-flex items-center gap-1.5">
          {onInspectDay && day.saleCount > 0 ? (
            <button
              type="button"
              onClick={() => onInspectDay(day.day)}
              className="rounded-sm text-left transition-colors duration-[120ms] hover:text-white hover:underline underline-offset-2 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/50"
            >
              {formatDayLabelWithWeekday(day.day)}
            </button>
          ) : (
            <span className={cn(isToday && 'font-medium text-foreground')}>{formatDayLabelWithWeekday(day.day)}</span>
          )}

          {/* The icon was `aria-hidden` on a hover-only trigger, so this fact —
              the hours could not be derived — reached neither a screen reader nor
              a keyboard. One sentence, declared once, rendered in both places. */}
          {day.missingShift && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  tabIndex={0}
                  className="inline-flex shrink-0 cursor-help rounded-sm focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  <AlertTriangle className="size-3.5 text-orange-400" aria-hidden />
                  <span className="sr-only">{MISSING_SHIFT_EXPLANATION}</span>
                </span>
              </TooltipTrigger>
              <TooltipContent className="max-w-64 text-center leading-relaxed">
                {MISSING_SHIFT_EXPLANATION}
              </TooltipContent>
            </Tooltip>
          )}

          {day.note && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  tabIndex={0}
                  className="inline-flex shrink-0 cursor-help rounded-sm focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  <StickyNote className="size-3.5 text-zinc-400" aria-hidden />
                  <span className="sr-only">{day.note}</span>
                </span>
              </TooltipTrigger>
              <TooltipContent className="max-w-64 leading-relaxed">{day.note}</TooltipContent>
            </Tooltip>
          )}
        </span>
      </th>

      {cell('gross', 'grossEarnings', day.grossEarnings === 0 ? '—' : formatUsd(day.grossEarnings), day.grossEarnings, signedMoneyClass(day.grossEarnings))}

      <td className="whitespace-nowrap px-2.5 py-2 text-right tabular-nums">
        {day.netEarnings === 0 ? '—' : formatUsd(day.netEarnings)}
      </td>

      {cell('pct', 'commissionPercent', formatPercent(day.commissionPercent), day.commissionPercent, 'text-zinc-400')}
      {cell('commission', 'commission', day.commission === 0 ? '—' : formatUsd(day.commission), day.commission)}
      {cell('hours', 'hours', formatHours(day.hours), day.hours)}

      {cell(
        'accounts',
        'accountCount',
        day.accountCount === 0 ? '—' : String(day.accountCount),
        day.accountCount,
        day.accountCountSource === 'sales' ? 'text-orange-400' : undefined,
      )}

      {cell('rate', 'hourlyRate', day.hourlyRate === 0 ? '—' : formatUsd(day.hourlyRate), day.hourlyRate, 'text-zinc-400')}
      {cell('wage', 'wage', day.wage === 0 ? '—' : formatUsd(day.wage), day.wage)}
      {cell('salary', 'salary', day.salary === 0 ? '—' : formatUsd(day.salary), day.salary, 'font-medium')}
    </tr>
  );
}

function OverrideExplanation({
  override,
}: {
  override: NonNullable<SalaryDayResult['overrides'][SalaryOverrideField]>;
}) {
  return (
    <span className="block space-y-1">
      <span className="block">
        Edited by {override.setByName ?? 'an administrator'}
        {override.reason ? ` — ${override.reason}` : ''}
      </span>
      <span className="block text-zinc-400">
        Calculated value: <span className="tabular-nums">{override.computed}</span>
      </span>
    </span>
  );
}
