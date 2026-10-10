'use client';

import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { formatDayLabel, formatDayLabelWithWeekday } from '@/lib/salary/salaryDate';
import {
  formatSaleDateTime,
  formatSaleDateTimeInSalaryZone,
  formatShiftWindow,
  formatShiftWindowInSalaryZone,
  formatZoneOffset,
  localDayKey,
  readsSalaryClock,
} from '@/lib/salary/salaryFormat';

/**
 * The two clocks on the salary surfaces, made explicit.
 *
 * Pay is bucketed by **salary day** — midnight to midnight SAST for every agent
 * (ca-salary.md §7) — while clock times render in the reader's own timezone.
 * For an agent outside UTC+2 the two disagree: a tip at 23:30 SAST is "5:30 AM
 * the next day" on a UTC+8 clock but still counts on the SAST day. Every time
 * on these surfaces therefore says which clock it is, and a sale whose local
 * date differs from its salary day says so in the row, not only on hover.
 */

/** Declared once so every surface explains the boundary in the same words. */
export const SALARY_DAY_HINT =
  'Salary days run midnight to midnight SAST (UTC+2) for every agent, wherever they are. A shift is paid on the day it starts; each sale counts on the SAST day it happened.';

/** `asChild` forwards props but adds no tabIndex — without one a hint is mouse-only. */
const HINT_TRIGGER =
  'cursor-help rounded-sm focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50';

/** A column label with a dotted underline that explains itself on hover or focus. */
export function HintedLabel({ label, hint, className }: { label: string; hint: string; className?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className={cn(HINT_TRIGGER, 'border-b border-dotted border-white/20', className)}>
          {label}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-64 text-center leading-relaxed">{hint}</TooltipContent>
    </Tooltip>
  );
}

/** The ledger's "When" cell: local time, plus the salary day when the two differ. */
export function SaleWhen({ occurredAt, day, timezone }: { occurredAt: string; day: string; timezone: string }) {
  const ms = Date.parse(occurredAt);
  const sameClock = readsSalaryClock(ms, timezone);
  const crossesDay = !sameClock && localDayKey(ms, timezone) !== day;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className={cn(HINT_TRIGGER, 'inline-flex items-center gap-1.5')}>
          {formatSaleDateTime(occurredAt, timezone)}
          {crossesDay && (
            <span className="rounded-full bg-white/[0.06] px-1.5 py-0.5 text-[11px] text-zinc-300">
              Counts {formatDayLabel(day)}
            </span>
          )}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-64 leading-relaxed">
        {sameClock ? (
          <p>{formatSaleDateTime(occurredAt, timezone)} — your time, which is also SAST.</p>
        ) : (
          <>
            <p>Your time ({formatZoneOffset(ms, timezone)}): {formatSaleDateTime(occurredAt, timezone)}</p>
            <p>SAST (GMT+2): {formatSaleDateTimeInSalaryZone(occurredAt)}</p>
          </>
        )}
        <p className="mt-1">Counts toward salary day {formatDayLabelWithWeekday(day)}.</p>
      </TooltipContent>
    </Tooltip>
  );
}

/** A shift's scheduled window in the reader's time, with the roster's SAST window on hover. */
export function ShiftWindow({
  startMs,
  scheduledHours,
  timezone,
}: {
  startMs: number;
  scheduledHours: number;
  timezone: string;
}) {
  const local = formatShiftWindow(startMs, scheduledHours, timezone);
  if (!local) return null;
  const sameClock = readsSalaryClock(startMs, timezone);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className={cn(HINT_TRIGGER, 'tabular-nums')}>
          {local}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-64 leading-relaxed">
        {sameClock ? (
          <p>Your time, which is also SAST.</p>
        ) : (
          <>
            <p>Your time ({formatZoneOffset(startMs, timezone)}).</p>
            <p>SAST (GMT+2): {formatShiftWindowInSalaryZone(startMs, scheduledHours)}</p>
          </>
        )}
        <p className="mt-1">Paid on the SAST day the shift starts.</p>
      </TooltipContent>
    </Tooltip>
  );
}
