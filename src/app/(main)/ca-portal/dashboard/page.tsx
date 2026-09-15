'use client';

import { useState } from 'react';
import AppLayout from '@/components/AppLayout';
import { SalarySummaryCard } from '@/components/salary/SalarySummaryCard';
import { ShiftCalendar } from '@/components/shifts/ShiftCalendar';
import { LeaveBalanceCard } from '@/components/shifts/LeaveBalanceCard';
import { MonthPicker } from '@/components/salary/MonthPicker';
import { currentMonthKey } from '@/lib/salary/salaryDate';
import { useViewerTimezone } from '@/hooks/useViewerTimezone';
import { useSalaryEarliestMonth } from '@/hooks/useSalaryEarliestMonth';

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
 * ## One month governs the page
 *
 * The picker sits on the heading row, not above the calendar. It used to sit
 * mid-page and drive only the calendar while `SalarySummaryCard` pinned itself to
 * the current month — so stepping back to August showed August's roster above
 * September's pay, both labelled correctly, with nothing saying the two scopes
 * differed. On a payroll surface that is the shape of a real dispute. An agent
 * checking August wants August's pay, so the month is lifted and passed to both.
 */

export default function CaDashboardPage() {
  const [month, setMonth] = useState(currentMonthKey());
  const { timezone } = useViewerTimezone();
  const earliest = useSalaryEarliestMonth();

  return (
    <AppLayout>
      <div className="max-w-5xl">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-tight">
              {'My Dashboard'}
            </h1>
            <p className="mt-1 text-sm text-zinc-400">
              See your earnings, your shift schedule, and available overtime shifts here.
            </p>
          </div>

          <MonthPicker month={month} onChange={setMonth} earliest={earliest} className="shrink-0" />
        </div>

        <div className="mt-6 space-y-5">
          <SalarySummaryCard month={month} />

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
          <ShiftCalendar month={month} timezone={timezone} showOvertime />
        </div>
      </div>
    </AppLayout>
  );
}
