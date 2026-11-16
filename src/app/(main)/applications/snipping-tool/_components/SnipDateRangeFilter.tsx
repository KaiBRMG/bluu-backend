'use client';

import { useEffect, useMemo, useState } from 'react';
import type { DateRange } from 'react-day-picker';
import { CalendarIcon, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { addCalendarDays, todayStr } from '@/lib/utils/timezone';

/**
 * An inclusive range of calendar days, as `YYYY-MM-DD` in the **viewer's**
 * timezone — the same zone every card on the page renders its date in.
 *
 * Held as day strings rather than instants so the filter means the same thing
 * if the zone is corrected or resolves late: the page turns it into UTC bounds
 * (`getDayBoundsUTC`) at the moment it asks the server.
 */
export interface SnipDayRange {
  from: string;
  to: string;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** A `Calendar` date (local midnight) → its calendar day. Local parts on purpose. */
const dayOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** A calendar day → a local-midnight `Date`, which is what `Calendar` selects on. */
function dateOf(day: string): Date {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** "3 Nov", or "3 Nov 2025" when the year is not the current one. */
function dayLabel(day: string, thisYear: string): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: String(y) === thisYear ? undefined : 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

/** The label for a range — shared with the page's filtered-empty line. */
export function snipRangeLabel(range: SnipDayRange, timezone: string): string {
  const thisYear = todayStr(timezone).slice(0, 4);
  return range.from === range.to
    ? dayLabel(range.from, thisYear)
    : `${dayLabel(range.from, thisYear)} – ${dayLabel(range.to, thisYear)}`;
}

interface SnipDateRangeFilterProps {
  value: SnipDayRange | null;
  onChange: (next: SnipDayRange | null) => void;
  timezone: string;
}

/**
 * Filters the library to snips created within a range of days.
 *
 * **The calendar edits a draft; Apply commits it.** Applying on every click
 * would fetch after the first click of a two-click gesture — a request for a
 * one-day range the user is about to widen — and then again on the second. A
 * draft makes the filter one request, and closing the popover any other way
 * discards it, which is what a user who changed their mind expects.
 *
 * A range with only a start (one click) is a single day, so "show me the 3rd" is
 * pick, Apply — not pick, pick-the-same-day.
 *
 * Presets are in the viewer's timezone, like every date on the page, and apply
 * immediately: they are a complete answer on their own.
 */
export function SnipDateRangeFilter({ value, onChange, timezone }: SnipDateRangeFilterProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DateRange | undefined>(undefined);

  // Re-seed the draft from the applied value each time the popover opens, so a
  // discarded edit never leaks into the next visit.
  useEffect(() => {
    if (open) setDraft(value ? { from: dateOf(value.from), to: dateOf(value.to) } : undefined);
  }, [open, value]);

  const today = todayStr(timezone);
  const presets = useMemo(
    () => [
      { label: 'Today', range: { from: today, to: today } },
      { label: 'Last 7 days', range: { from: addCalendarDays(today, -6), to: today } },
      { label: 'Last 30 days', range: { from: addCalendarDays(today, -29), to: today } },
      { label: 'This month', range: { from: `${today.slice(0, 8)}01`, to: today } },
    ],
    [today],
  );

  const apply = (range: SnipDayRange | null) => {
    onChange(range);
    setOpen(false);
  };

  // Show the month before the current one on the left, so "this month" lands on
  // the right-hand calendar with the recent past beside it.
  const defaultMonth = useMemo(() => {
    const base = dateOf(value?.from ?? today);
    return value ? base : new Date(base.getFullYear(), base.getMonth() - 1, 1);
  }, [value, today]);

  return (
    <div className="flex items-center gap-1">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" aria-label="Filter by date">
            <CalendarIcon className="size-4" />
            {value ? (
              <span className="tabular-nums">{snipRangeLabel(value, timezone)}</span>
            ) : (
              'Date'
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-auto p-0">
          <div className="flex flex-wrap gap-1 border-b border-white/[0.07] p-2">
            {presets.map(preset => (
              <Button
                key={preset.label}
                variant="ghost"
                size="xs"
                onClick={() => apply(preset.range)}
              >
                {preset.label}
              </Button>
            ))}
          </div>
          <Calendar
            mode="range"
            numberOfMonths={2}
            defaultMonth={defaultMonth}
            selected={draft}
            onSelect={setDraft}
            // Nothing can have been captured tomorrow.
            disabled={{ after: dateOf(today) }}
          />
          <div className="flex items-center justify-between gap-2 border-t border-white/[0.07] p-2">
            <Button variant="ghost" size="sm" onClick={() => apply(null)} disabled={!value && !draft}>
              Clear
            </Button>
            <Button
              size="sm"
              disabled={!draft?.from}
              onClick={() => {
                if (!draft?.from) return;
                apply({ from: dayOf(draft.from), to: dayOf(draft.to ?? draft.from) });
              }}
            >
              Apply
            </Button>
          </div>
        </PopoverContent>
      </Popover>

      {/* A sibling, not a child, of the trigger: a button inside a button is
          invalid, and the clear has to be reachable without opening anything. */}
      {value && (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Clear date filter"
          onClick={() => onChange(null)}
        >
          <X className="size-4" />
        </Button>
      )}
    </div>
  );
}
