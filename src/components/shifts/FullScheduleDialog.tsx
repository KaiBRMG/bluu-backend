'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { MonthPicker } from '@/components/salary/MonthPicker';
import { ShiftCalendar } from './ShiftCalendar';
import { addMonths, currentMonthKey } from '@/lib/salary/salaryDate';

/**
 * The whole month, on top of the dashboard.
 *
 * The dashboard leads with the week because that is the horizon an agent acts on
 * (see `ShiftCalendar`), but "am I on over Easter" and "how many days am I
 * covering Adam this month" are real questions the week cannot answer. This is
 * the month view, one click away, at a size the month grid actually deserves —
 * ~90px cells inside a `max-w-5xl` page column are the reason the month was never
 * comfortable there in the first place.
 *
 * **It is the same `ShiftCalendar`, not a second one.** Requesting leave, the
 * overtime layer and the claim popover all live in the day cell, so passing
 * `view="month"` is the entire difference — there is no behaviour here that the
 * dashboard lacks, and no second implementation to drift.
 *
 * ## The month picker's ceiling is raised on purpose
 *
 * `MonthPicker` caps forward navigation at the current month everywhere else,
 * because a future *salary* month has no data by definition. A roster is the
 * opposite: it is published ahead, and next month is the thing people open this
 * for. Hence `latest` — twelve months out, which is further than any roster is
 * ever planned.
 */

const MONTHS_AHEAD = 12;

export function FullScheduleDialog({
  open,
  onOpenChange,
  timezone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  timezone: string;
}) {
  const [month, setMonth] = useState(currentMonthKey);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Wider than the app's other dialogs because the content is a seven-column
          grid: at `sm:max-w-lg` a day cell is ~60px, which cannot hold a time, a
          row of accounts and an offer. Capped at the viewport height with the grid
          scrolling, so a 6-row month never pushes its own header off screen. */}
      <DialogContent className="flex max-h-[88vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl">
        <DialogHeader className="shrink-0 border-b border-white/[0.07] px-6 py-4">
          {/* The picker sits on the title row — pr-10 keeps it clear of the
              dialog's own close button, which is absolutely positioned. */}
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 pr-10">
            <div className="min-w-0">
              <DialogTitle>Full schedule</DialogTitle>
              <DialogDescription className="mt-1">
                Your shifts for the month. Request time off on a shift, or claim overtime going spare.
              </DialogDescription>
            </div>

            <MonthPicker
              month={month}
              onChange={setMonth}
              latest={addMonths(currentMonthKey(), MONTHS_AHEAD)}
              className="shrink-0"
            />
          </div>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          <ShiftCalendar
            view="month"
            month={month}
            timezone={timezone}
            showOvertime
            bare
            // The boot screen is long gone by the time this opens, and the phase
            // key is shared with the dashboard's own calendar.
            gateBoot={false}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
