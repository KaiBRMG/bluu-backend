'use client';

import { useState } from 'react';
import AppLayout from '@/components/AppLayout';
import { SalarySummaryCard } from '@/components/salary/SalarySummaryCard';
import { ShiftCalendar } from '@/components/shifts/ShiftCalendar';
import { FullScheduleDialog } from '@/components/shifts/FullScheduleDialog';
import { LeaveBalanceCard } from '@/components/shifts/LeaveBalanceCard';
import { SaleDisputesPanel } from '@/components/disputes/SaleDisputesPanel';
import { useViewerTimezone } from '@/hooks/useViewerTimezone';

/**
 * `/ca-portal/dashboard` — the chat agent's home.
 *
 * Ordered by what an agent opens the app to find out: what am I earning, how
 * much time off do I have left, and when am I working. The salary card is first
 * because it is the question that used to require asking someone for a
 * spreadsheet; the leave balance sits above the calendar because it is the
 * constraint you read *before* picking a day to request off.
 *
 * Overtime lives *inside* the calendar rather than beside it — see
 * `ShiftCalendar` for why the two layers share one grid. Requesting leave lives
 * on the shift itself, for the same reason.
 *
 * Only the salary card links onward, and only to a sub-route of this page's own
 * permission. A dashboard card must not link to a page the viewer may not hold
 * — `AppLayout` redirects an inaccessible route to the home page, which is
 * exactly what the leave card used to do. The disputes column obeys the same
 * rule the hard way: it has no onward link at all, because everything it could
 * link to is now a dialog on this page.
 *
 * ## Two columns, because there were two jobs and one of them had no home
 *
 * The page ran at `max-w-5xl` with a third of the window empty beside it, while
 * disputes — the one thing on an agent's plate with someone else waiting on the
 * other end of it — sat on `/ca-portal/disputes`, a page that is empty most
 * days and therefore never opened. The right column is that queue, in the space
 * that was already there. See `SaleDisputesPanel`.
 *
 * The split is `xl` and up. Below that the three cards stack in reading order,
 * and the disputes column lands **between the leave balance and the calendar**
 * rather than at the bottom: a queue somebody is waiting on must not be the
 * thing you scroll past a month of shifts to find. That ordering is what the
 * `xl:row-span-2` buys — at one column the grid is simply source order, and at
 * two the aside takes the full height of the right-hand track.
 *
 * ## No month governs the page any more
 *
 * It used to. One `MonthPicker` on the heading row drove the salary card and the
 * calendar together, because the alternative at the time was worse: a picker that
 * moved only the calendar could put August's roster above September's pay with
 * both labels correct and nothing saying the two scopes differed.
 *
 * The page no longer has one scope to pick, so it no longer has a picker:
 *
 * - **The schedule is a week**, and it navigates itself with arrows. A dashboard
 *   is read for the horizon you act on — am I on tomorrow, is there cover going
 *   spare this week — and a month of ~90px cells buries that in a thirty-cell
 *   scan. The month is still one click away in `FullScheduleDialog`, which
 *   carries its own picker along with everything else the week view can do.
 * - **The salary card shows the current, unfinalised month**, which is the only
 *   month a dashboard summary should ever mean. History belongs on
 *   `/ca-portal/dashboard/salary`, which has a picker of its own.
 *
 * So the two scopes cannot disagree — not because one control governs both, but
 * because neither is a scope the reader has to hold in their head.
 */

export default function CaDashboardPage() {
  const { timezone } = useViewerTimezone();
  const [fullScheduleOpen, setFullScheduleOpen] = useState(false);

  return (
    <AppLayout>
      {/* The left track keeps the measure the salary card and the calendar were
          built for; the right one is fixed, because a dispute row is a fixed
          amount of information and a column that grew with the window would
          just add space between the tick and the cross. */}
      <div className="max-w-[88rem]">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight">{'My Dashboard'}</h1>
          <p className="mt-1 text-sm text-zinc-400">
            See your earnings, your shift schedule, and available overtime shifts here.
          </p>
        </div>

        <div className="mt-6 grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_23rem]">
          <div className="min-w-0 space-y-5">
            <SalarySummaryCard />

            {/* Above the calendar: the balance is the constraint you read *before*
                picking a day to request off, not a footnote to it. */}
            <LeaveBalanceCard />
          </div>

          {/* Second in source order so it lands between the balance and the
              calendar when the grid collapses to one column — see the header
              comment. `row-span-2` is what gives it the whole right-hand track
              at `xl`, rather than leaving the calendar's height beside it blank. */}
          <SaleDisputesPanel timezone={timezone} className="min-w-0 xl:row-span-2" />

          {/* Overtime renders inside the calendar rather than in a section of
              its own: an offer is only worth claiming relative to the shifts
              you already work that week, and a separate board made the reader
              hold both in their head.

              No wrapper `<section>` and no `sr-only` heading — `ShiftCalendar`
              renders its own visible `<h2>`, and two headings for one region
              (one of them invisible) is what attached the picker to the wrong
              thing in the first place. */}
          <div className="min-w-0">
            <ShiftCalendar
              view="week"
              timezone={timezone}
              showOvertime
              onOpenFullSchedule={() => setFullScheduleOpen(true)}
            />
          </div>
        </div>

        <FullScheduleDialog
          open={fullScheduleOpen}
          onOpenChange={setFullScheduleOpen}
          timezone={timezone}
        />
      </div>
    </AppLayout>
  );
}
