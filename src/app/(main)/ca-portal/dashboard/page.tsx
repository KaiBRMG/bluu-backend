'use client';

import { useState } from 'react';
import AppLayout from '@/components/AppLayout';
import { SalarySummaryCard } from '@/components/salary/SalarySummaryCard';
import { ShiftCalendar } from '@/components/shifts/ShiftCalendar';
import { FullScheduleDialog } from '@/components/shifts/FullScheduleDialog';
import { LeaveBalanceCard } from '@/components/shifts/LeaveBalanceCard';
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
 * exactly what the leave card used to do.
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
      <div className="max-w-5xl">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight">{'My Dashboard'}</h1>
          <p className="mt-1 text-sm text-zinc-400">
            See your earnings, your shift schedule, and available overtime shifts here.
          </p>
        </div>

        <div className="mt-6 space-y-5">
          <SalarySummaryCard />

          {/* Above the calendar: the balance is the constraint you read *before*
              picking a day to request off, not a footnote to it. */}
          <LeaveBalanceCard />

          {/* Overtime renders inside the calendar rather than in a section of
              its own: an offer is only worth claiming relative to the shifts
              you already work that week, and a separate board made the reader
              hold both in their head.

              No wrapper `<section>` and no `sr-only` heading — `ShiftCalendar`
              renders its own visible `<h2>`, and two headings for one region
              (one of them invisible) is what attached the picker to the wrong
              thing in the first place. */}
          <ShiftCalendar
            view="week"
            timezone={timezone}
            showOvertime
            onOpenFullSchedule={() => setFullScheduleOpen(true)}
          />
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
