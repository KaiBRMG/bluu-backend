'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { addMonths, currentMonthKey, formatMonthLabel } from '@/lib/salary/salaryDate';

/**
 * Step through salary months.
 *
 * Two arrows and a label, not a date picker: months are read sequentially and
 * the one anyone wants is almost always this one or last one. Forward is capped
 * at the current month — a future month has no data by definition, and an
 * enabled control that always lands on an empty screen teaches people to
 * distrust the control.
 *
 * `earliest` stops the back arrow at the first month with data, so the same
 * lesson holds in the other direction.
 */

interface MonthPickerProps {
  month: string;
  onChange: (month: string) => void;
  /** Oldest selectable month, `YYYY-MM`. Defaults to two years back. */
  earliest?: string;
  className?: string;
}

export function MonthPicker({ month, onChange, earliest, className }: MonthPickerProps) {
  const latest = currentMonthKey();
  const floor = earliest ?? addMonths(latest, -24);

  const previous = addMonths(month, -1);
  const next = addMonths(month, 1);

  const canGoBack = previous >= floor;
  const canGoForward = next <= latest;

  return (
    <div className={className}>
      <div className="flex items-center gap-1">
        <Button
          size="icon-sm"
          variant="ghost"
          disabled={!canGoBack}
          onClick={() => onChange(previous)}
          aria-label={`Previous month, ${formatMonthLabel(previous)}`}
        >
          <ChevronLeft aria-hidden />
        </Button>

        {/* aria-live so a screen reader hears the month change without the
            arrows stealing focus or announcing themselves twice. */}
        <span className="min-w-[9.5rem] text-center text-sm font-medium tabular-nums" aria-live="polite">
          {formatMonthLabel(month)}
        </span>

        <Button
          size="icon-sm"
          variant="ghost"
          disabled={!canGoForward}
          onClick={() => onChange(next)}
          aria-label={`Next month, ${formatMonthLabel(next)}`}
        >
          <ChevronRight aria-hidden />
        </Button>

        {month !== latest && (
          <Button size="xs" variant="ghost" onClick={() => onChange(latest)} className="ml-1 text-zinc-400">
            This month
          </Button>
        )}
      </div>
    </div>
  );
}
