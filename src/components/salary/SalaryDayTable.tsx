'use client';

import { useState } from 'react';
import { AlertTriangle, ChevronRight, Pencil, StickyNote } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { CreatorChipList } from '@/components/creators/CreatorChip';
import { useViewerTimezone } from '@/hooks/useViewerTimezone';
import { SalaryCellEditor } from './SalaryCellEditor';
import { formatDayLabelWithWeekday, currentDayKey } from '@/lib/salary/salaryDate';
import {
  formatHours,
  formatPercent,
  formatShiftWindow,
  formatUsd,
  pluralise,
  signedMoneyClass,
} from '@/lib/salary/salaryFormat';
import type {
  SalaryDayResult,
  SalaryMonthResult,
  SalaryOverrideField,
  SalaryShiftBreakdown,
} from '@/lib/salary/salaryTypes';

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
 *
 * ## Multi-shift days expand
 *
 * `Accts` and `$/hr` are **day-level roll-ups**, and on a day with more than one
 * shift neither is a figure anyone was paid: accounts is the *union* of the
 * shifts' creators (so a regular shift of 4 plus an overtime shift of 3 sharing
 * 2 creators reads `5`), and the rate is the hours-weighted *blend* of the
 * shifts' own rates (`$3.50` + `$4.50` → `~$3.99`). Under the default
 * `per-shift` rate basis each shift is priced on its own accounts and the day's
 * pay is their sum — so the two columns sit next to each other looking like an
 * arithmetic error, which is exactly how this was reported.
 *
 * The fix is disclosure, not a different number: the roll-ups are still correct
 * summaries and the wage still reconciles against them. A chevron on the date
 * opens one sub-row per shift carrying its own accounts, rate, hours and pay,
 * and a blended rate is prefixed `~` so it reads as a summary rather than a
 * rate. Collapsed is the default and a single-shift day gets no chevron at all,
 * so the one-row-per-date scan above is untouched.
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
  {
    key: 'accounts',
    label: 'Accts',
    field: 'accountCount',
    hint: 'Distinct creator accounts worked. Each shift is rated on its own accounts — expand a date to see the split.',
  },
  {
    key: 'rate',
    label: '$/hr',
    field: 'hourlyRate',
    hint: 'The hourly rate. A day with more than one shift shows the blended average (~), not a rate that was paid.',
  },
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
  // Read once and passed down rather than called per row: `useUserData` is a
  // context read, so thirty subscriptions would be thirty consumers re-rendering
  // on every write to the user doc for a value that changes about never.
  const { timezone } = useViewerTimezone();
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
              timezone={timezone}
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
  timezone,
}: {
  day: SalaryDayResult;
  isToday: boolean;
  canEdit: boolean;
  userId?: string;
  openCell: string | null;
  setOpenCell: (key: string | null) => void;
  onMonthChange?: (next: SalaryMonthResult) => void;
  onInspectDay?: (day: string) => void;
  timezone: string;
}) {
  const [expanded, setExpanded] = useState(false);

  const isEmpty = day.saleCount === 0 && day.hours === 0 && Object.keys(day.overrides).length === 0;

  // `shifts` has always been on `SalaryDayResult`, so every finalised month has
  // it — but a frozen month is replayed from stored JSON rather than recomputed,
  // so it is defended rather than trusted.
  const shifts = day.shifts ?? [];
  const payingShifts = shifts.filter(s => s.paysWage && s.payableHours > 0);
  const isBlendedRate = payingShifts.length > 1 && !day.overrides.hourlyRate;

  // A single ordinary shift tells you nothing the row does not already say, and
  // a chevron on every row is noise on a thirty-row table. Expansion is offered
  // only where the roll-up hides something: more than one shift, an overtime
  // shift, or in-shift cover (which adds accounts while paying no wage).
  const expandable =
    shifts.length > 1 ||
    shifts.some(s => s.isOvertime || !s.paysWage || (s.overtimeCreatorIds?.length ?? 0) > 0);
  const hasOvertime = shifts.some(s => s.isOvertime);

  const cell = (
    key: string,
    field: SalaryOverrideField | undefined,
    display: string,
    rawValue: number,
    className?: string,
    titleText?: string,
  ) => {
    const override = field ? day.overrides[field] : undefined;
    const cellKey = `${day.day}:${key}`;

    // No blue ink on an overridden figure. Action Blue already means "today" two
    // rows down and "magnitude" in the sales report, and at 14px on the canvas it
    // measures ~4.3:1 — under the AA floor for the one number most likely to be
    // disputed. The pencil carries the signal instead, in both modes.
    const content = (
      <span className={cn('tabular-nums', className)} title={titleText}>
        {display}
        {titleText && <span className="sr-only"> — {titleText}</span>}
      </span>
    );

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
    <>
    <tr className={cn(isEmpty && 'text-zinc-400', isToday && 'bg-action-blue/[0.06]')}>
      <th scope="row" className="whitespace-nowrap px-3 py-2 text-left font-normal">
        <span className="inline-flex items-center gap-1.5">
          {/* The disclosure sits in the date cell rather than on the figures it
              explains, because every one of those cells is an editor on the
              payroll surface and a second click target inside one is how you
              open a popover by trying to expand a row. It also keeps the
              affordance in the same place on both surfaces. */}
          {expandable ? (
            <button
              type="button"
              onClick={() => setExpanded(v => !v)}
              aria-expanded={expanded}
              className="-ml-1 inline-flex shrink-0 rounded-sm p-0.5 text-zinc-500 transition-colors duration-[120ms] hover:text-zinc-300 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <ChevronRight
                className={cn('size-3.5 transition-transform duration-[120ms]', expanded && 'rotate-90')}
                aria-hidden
              />
              <span className="sr-only">
                {expanded ? 'Hide' : 'Show'} the {pluralise(shifts.length, 'shift')} behind{' '}
                {formatDayLabelWithWeekday(day.day)}
              </span>
            </button>
          ) : (
            // Keeps the date column's text aligned down the whole table; a
            // chevron on some rows and not others would otherwise indent them.
            <span className="inline-block w-3.5 shrink-0" aria-hidden />
          )}

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

          {/* An attribute chip, in greyscale. Overtime is a property the day
              carries, not a state it is in (DESIGN.md §5) — and the two hues
              this table already spends, orange on an inferred account count and
              on the missing-shift triangle, both mean "check this". Overtime
              needs no checking, so giving it a hue here would make a routine day
              read as a problem. */}
          {hasOvertime && (
            <span className="shrink-0 rounded-md bg-white/[0.08] px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-zinc-300">
              OT
            </span>
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
        // Suppressed on an overridden count, where the figure is an admin's
        // instruction and the union arithmetic below no longer describes it.
        payingShifts.length > 1 && !day.overrides.accountCount
          ? describeAccountUnion(payingShifts, day.accountCount)
          : undefined,
      )}

      {/* `~` is the whole point of the fix in one character: it says the figure
          is a summary before anyone tries to multiply by it. It is suppressed on
          an overridden rate, where the number is an admin's instruction rather
          than a blend. */}
      {cell(
        'rate',
        'hourlyRate',
        day.hourlyRate === 0 ? '—' : `${isBlendedRate ? '~' : ''}${formatUsd(day.hourlyRate)}`,
        day.hourlyRate,
        'text-zinc-400',
        isBlendedRate
          ? `Blended across ${pluralise(payingShifts.length, 'shift')}. Hourly pay is the sum of each shift at its own rate, not hours times this figure.`
          : undefined,
      )}
      {cell('wage', 'wage', day.wage === 0 ? '—' : formatUsd(day.wage), day.wage)}
      {cell('salary', 'salary', day.salary === 0 ? '—' : formatUsd(day.salary), day.salary, 'font-medium')}
    </tr>

    {expanded &&
      shifts.map((shift, index) => (
        <ShiftRow
          key={`${shift.shiftId}:${shift.occurrenceStart}`}
          shift={shift}
          isFirst={index === 0}
          timezone={timezone}
        />
      ))}
    </>
  );
}

/**
 * Why the day's account count is smaller than the shifts' counts added up.
 *
 * The count is a **union** of the shifts' creators, so a 4-account regular shift
 * and a 3-account overtime shift covering two of the same creators reads `5`,
 * not `7`. Nothing on the row says so, and "5" beside a $3.99 blended rate is
 * what makes a correctly-paid day look miscalculated.
 */
function describeAccountUnion(payingShifts: SalaryShiftBreakdown[], dayCount: number): string {
  const summed = payingShifts.reduce((sum, shift) => sum + shift.accountCount, 0);
  const shared = summed - dayCount;
  const lead = `${pluralise(dayCount, 'distinct account')} across ${pluralise(payingShifts.length, 'shift')}`;

  return shared > 0
    ? `${lead} — ${pluralise(shared, 'account')} worked on more than one shift, counted once. Expand the date for each shift's own count.`
    : `${lead}, none shared. Expand the date for each shift's own count.`;
}

// ─── Shift sub-row ───────────────────────────────────────────────────

/**
 * One shift inside an expanded day, aligned to the day columns it can speak to.
 *
 * The four columns it cannot — gross, net, commission rate, commission — are a
 * single `colSpan`, not four `—`s. Commission is earned on the day's sales and
 * is genuinely not attributable to one shift of it; four em-dashes would read as
 * "this shift earned nothing", which is a different and false claim. The span
 * carries the reason once, on the first sub-row only, where it answers the
 * question rather than repeating it down the block.
 */
function ShiftRow({
  shift,
  isFirst,
  timezone,
}: {
  shift: SalaryShiftBreakdown;
  isFirst: boolean;
  timezone: string;
}) {
  // In-shift cover is stored as its own zero-wage shift precisely so it cannot
  // raise the real shift's account count and therefore its rate (see
  // ca-salary.md §6). Saying so here is the point of showing the row at all —
  // otherwise it looks like accounts that went unpaid by mistake.
  const kind = !shift.paysWage ? 'In-shift cover' : shift.isOvertime ? 'Overtime' : 'Regular';
  const window = formatShiftWindow(shift.occurrenceStart, shift.scheduledHours, timezone);

  // The other half of the same rule: accounts marked overtime *on* a paying
  // shift. `accountCount` on this row already excludes them, so without saying
  // so the row reads as five faces beside the number three.
  const overtimeIds = shift.overtimeCreatorIds ?? [];

  return (
    <tr className="bg-white/[0.02] text-[13px] text-zinc-400">
      <th scope="row" className="py-1.5 pl-9 pr-3 text-left font-normal">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-medium text-zinc-300">{kind}</span>
          {window && <span className="tabular-nums">{window}</span>}
          <CreatorChipList
            creatorIds={shift.creatorIds}
            overtimeIds={overtimeIds}
            max={4}
            size="xs"
            emptyLabel="No accounts assigned"
          />
          {shift.paysWage && overtimeIds.length > 0 && (
            <span
              className="text-[11px] text-orange-400"
              title="Worked inside this shift for the sales only. They add no hours and do not raise the hourly rate."
            >
              {overtimeIds.length} overtime
            </span>
          )}
        </span>
      </th>

      <td colSpan={4} className="px-2.5 py-1.5 text-right text-[11px] text-zinc-500">
        {isFirst && 'Commission is earned on the day’s sales, not split by shift'}
      </td>

      <td className="whitespace-nowrap px-2.5 py-1.5 text-right tabular-nums">
        {formatHours(shift.payableHours)}
      </td>
      <td className="whitespace-nowrap px-2.5 py-1.5 text-right tabular-nums">
        {shift.accountCount === 0 ? '—' : shift.accountCount}
      </td>
      <td className="whitespace-nowrap px-2.5 py-1.5 text-right tabular-nums">
        {shift.paysWage ? formatUsd(shift.hourlyRate) : '—'}
      </td>
      <td className="whitespace-nowrap px-2.5 py-1.5 text-right tabular-nums">
        {shift.paysWage ? (
          formatUsd(shift.wage)
        ) : (
          <span title="Cover taken inside a shift already being paid for, so it adds no hours and no wage.">
            No extra pay
          </span>
        )}
      </td>
      <td className="px-2.5 py-1.5" />
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
