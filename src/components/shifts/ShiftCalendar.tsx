'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  CalendarDays,
  CalendarX2,
  Check,
  ChevronLeft,
  ChevronRight,
  Loader2Icon,
  Plus,
  RotateCcw,
  Users,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { SURFACE } from '@/lib/surfaces';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useBootPhase } from '@/contexts/BootLoaderContext';
import { useShiftCalendar } from '@/hooks/useShiftCalendar';
import { useCoverageOffers, type CoverageOfferRow } from '@/hooks/useCoverageOffers';
import { useLeaveRequests, type LeaveRequest } from '@/hooks/useLeaveRequests';
import { RequestLeaveDialog, MIN_LEAVE_NOTICE_DAYS, type LeaveTarget } from './RequestLeaveDialog';
import {
  addDays,
  currentDayKey,
  currentMonthKey,
  dayOfWeek,
  daysInMonth,
  enumerateMonthDays,
  enumerateWeekDays,
  formatDayLabel,
  formatDayLabelWithWeekday,
  formatMonthLabel,
  monthOfDay,
  startOfWeek,
  toDayKey,
} from '@/lib/salary/salaryDate';
import { formatHours, pluralise } from '@/lib/salary/salaryFormat';
import type { ExpandedShift } from '@/lib/utils/recurrence';
import { matchLeaveToOccurrences, occurrenceKey } from '@/lib/utils/leaveMatch';
import { safeTimezone } from '@/lib/utils/timezone';
import { CreatorChip, CreatorChipList } from '@/components/creators/CreatorChip';
import { splitShiftAccounts } from '@/lib/salary/shiftAccounts';

/**
 * The agent's roster at a glance: which days they work, which accounts, and what
 * overtime is going spare.
 *
 * Built as a real calendar grid rather than an agenda list because the question
 * it answers is shaped like a calendar — "am I on next Tuesday", "how many days
 * am I covering Adam". An agenda answers "what's next", which the dashboard's
 * shift list already does.
 *
 * ## Two views, one grid
 *
 * `view="week"` draws a single Monday-first row with its own arrows; `view="month"`
 * draws the full grid. They are the *same* cell renderer over a different list of
 * days, deliberately — the cell is where leave, in-shift cover and the overtime
 * popover all live, and a second implementation of it would be a second place for
 * those to drift.
 *
 * The **dashboard leads with the week** because that is the horizon an agent
 * actually acts on: am I on tomorrow, is there cover going spare this week. A
 * month of ~90px cells answers "am I on the 14th" and buries this week's shift in
 * a thirty-cell scan. The month is one click away in the Full Schedule dialog
 * (`FullScheduleDialog`), which is the same component with `view="month"` and a
 * `MonthPicker` in its header — so nothing an agent can do on the dashboard is
 * missing there, and nothing there needed reimplementing.
 *
 * A week is the one view that can straddle a month boundary, which is why
 * `useShiftCalendar` takes a list of months rather than one.
 *
 * ## One calendar, two layers, and the hierarchy is the design
 *
 * The agent's **own shifts are primary**: filled cell, solid time, full-size
 * avatars, and always first in the cell. Available overtime is **secondary** —
 * no fill, a dashed rule above it, and an orange dot. That ordering is
 * load-bearing: a board that competes with your actual roster is one you misread
 * on a Monday morning. Overtime is an opportunity, not an obligation, and it
 * should look like one.
 *
 * Merging the two also answers the question a separate board could not: *can I
 * actually take this?* An offer on the 14th sitting directly under the shift you
 * already work on the 14th makes "this is inside my shift" or "this is a second
 * shift that day" visible without arithmetic.
 *
 * ## Leave lives on the shift, not in a list
 *
 * Each future shift carries a small `CalendarX2` button. Requesting time off is
 * a thing you do *to a particular shift*, so the control belongs on it — and
 * approving it releases exactly that shift's creator accounts, which are already
 * shown right beside the button. The old "Upcoming Shifts" tab on the
 * time-tracking page existed only to host this and has been removed.
 *
 * ## Times are the agent's own
 *
 * Every time here renders in the viewer's timezone. The roster is managed in
 * SAST and half the team is in the Philippines; making people convert in their
 * heads (or in a browser extension) is the thing this is replacing.
 */

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Declared once so each tooltip and its screen-reader text cannot drift apart. */
const IN_SHIFT_COVER_EXPLANATION =
  'Extra account inside your existing shift. You keep the sales; your hours are unchanged.';

/**
 * The same fact as {@link IN_SHIFT_COVER_EXPLANATION}, for accounts marked
 * overtime **on** a shift the agent is already paid for.
 *
 * Two wordings because the two are genuinely different reads: a cover shift is
 * a whole row that pays nothing, while this is a subset of a row that does pay
 * — and the agent's question there is "why is my rate still on three accounts".
 */
const IN_SHIFT_OVERTIME_EXPLANATION =
  'Worked as overtime inside this shift. You keep the sales, but your hourly rate is still set by your regular accounts only.';

/** A shift that is nothing but overtime. It pays on its own accounts, like any other shift. */
const FULL_OVERTIME_EXPLANATION =
  'An overtime shift — every account on it is overtime, so it pays hourly on all of them, plus the sales.';

interface ShiftCalendarProps {
  /** The month to draw, `YYYY-MM`. Month view only — the week view navigates itself. */
  month?: string;
  timezone: string;
  /** Render available overtime alongside the agent's own shifts. */
  showOvertime?: boolean;
  /** `week` (default) draws one Monday-first row with its own arrows; `month` draws the grid. */
  view?: 'month' | 'week';
  /** Rendered on the header row — the `MonthPicker`, in the Full Schedule dialog. */
  headerAction?: ReactNode;
  /** Renders the Full Schedule button beside the week arrows. Week view only. */
  onOpenFullSchedule?: () => void;
  /** Drop the panel chrome and the `<h2>` — for a dialog that already provides both. */
  bare?: boolean;
  /**
   * Hold the boot screen until this instance's first load finishes (rule 8).
   *
   * Off for the dialog copy: the boot phase is keyed by name, so a second mount
   * sharing the key would clear the first one's phase when it unmounts — and the
   * dialog opens long after boot anyway.
   */
  gateBoot?: boolean;
  className?: string;
}

interface DayCell {
  day: string;
  date: number;
  shifts: ExpandedShift[];
  offers: CoverageOfferRow[];
}

export function ShiftCalendar({
  month: monthProp,
  timezone,
  showOvertime = false,
  view = 'week',
  headerAction,
  onOpenFullSchedule,
  bare = false,
  gateBoot = true,
  className,
}: ShiftCalendarProps) {
  const isWeek = view === 'week';
  const month = monthProp ?? currentMonthKey();

  // The week the arrows are parked on. Local state, not a prop: the dashboard has
  // no other use for it, and lifting it would make every arrow press re-render
  // the page rather than this panel.
  const [weekStart, setWeekStart] = useState(() => startOfWeek(currentDayKey()));
  const weekEnd = addDays(weekStart, 6);

  // A week can straddle a month boundary; a month never does. Fetching whole
  // months either way is what lets a week of September reuse the entry the last
  // week of September already warmed — see `useShiftCalendar`.
  const months = useMemo(
    () => (isWeek ? [...new Set([monthOfDay(weekStart), monthOfDay(weekEnd)])] : [month]),
    [isWeek, weekStart, weekEnd, month],
  );

  // The days actually drawn, which is what the overtime layer is asked for too.
  // Its default is a rolling window around today — right when the only view was
  // the current month, and wrong the moment the arrows can leave it: a week three
  // arrows out, or a month picked in the Full Schedule dialog, would draw the
  // roster and silently claim no cover was going spare.
  const rangeStart = isWeek ? weekStart : `${month}-01`;
  const rangeEnd = isWeek ? weekEnd : `${month}-${daysInMonth(month)}`;

  const { shifts, loading, error, refetch } = useShiftCalendar(months);
  const { offers, setClaim, loading: offersLoading } = useCoverageOffers({
    from: rangeStart,
    to: rangeEnd,
    status: 'available',
    enabled: showOvertime,
  });

  const { leaveRequests, requestLeave, cancelLeave } = useLeaveRequests();
  const [leaveTarget, setLeaveTarget] = useState<LeaveTarget | null>(null);

  // The salary card above this one gates the boot screen, so without this the
  // loader lifted on a finished card sitting over a skeleton calendar.
  useBootPhase('shift-calendar', gateBoot && loading);

  const tz = safeTimezone(timezone);
  const today = currentDayKey();
  // Not read in the render body — that would make the output depend on when React
  // happened to re-render. But this renderer routinely stays open for weeks
  // (CLAUDE.md rule 9c), and a clock captured once per mount eventually offers
  // "request time off" on shifts that started days ago. Refreshed when the window
  // comes back to the user, which is when they would next act on it.
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const sync = () => {
      if (document.visibilityState === 'visible') setNow(Date.now());
    };
    window.addEventListener('focus', sync);
    document.addEventListener('visibilitychange', sync);
    return () => {
      window.removeEventListener('focus', sync);
      document.removeEventListener('visibilitychange', sync);
    };
  }, []);

  // Keyed lookup so a cell does not scan the list per shift.
  //
  // Tiered rather than a strict `${shiftId}:${occurrenceStart}` lookup: an admin
  // edit re-homes the occurrence onto a new document id, and the strict key then
  // misses a request that is still pending — the cell would show the shift with
  // no "time off requested" badge while the approvals queue still holds it.
  // `leaveMatch.ts` carries the tiers and the cases it refuses to guess at.
  const leaveByOccurrence = useMemo(
    () => matchLeaveToOccurrences<LeaveRequest, ExpandedShift>(leaveRequests, shifts),
    [leaveRequests, shifts],
  );

  const { cells, weeks } = useMemo(() => {
    const shiftsByDay = new Map<string, ExpandedShift[]>();
    for (const shift of shifts) {
      const key = toDayKey(shift.occurrenceStart);
      const list = shiftsByDay.get(key);
      if (list) list.push(shift);
      else shiftsByDay.set(key, [shift]);
    }
    for (const list of shiftsByDay.values()) list.sort((a, b) => a.occurrenceStart - b.occurrenceStart);

    const offersByDay = new Map<string, CoverageOfferRow[]>();
    if (showOvertime) {
      for (const offer of offers) {
        const list = offersByDay.get(offer.day);
        if (list) list.push(offer);
        else offersByDay.set(offer.day, [offer]);
      }
      for (const list of offersByDay.values()) list.sort((a, b) => a.windowStart - b.windowStart);
    }

    const dayKeys = isWeek ? enumerateWeekDays(weekStart) : enumerateMonthDays(month);
    const built: DayCell[] = dayKeys.map(key => ({
      day: key,
      date: Number(key.slice(8, 10)),
      shifts: shiftsByDay.get(key) ?? [],
      offers: offersByDay.get(key) ?? [],
    }));

    // A week is already exactly one Monday-first row; only a month needs padding
    // to land its 1st under the right weekday.
    if (isWeek) return { cells: built, weeks: [built] };

    // Monday-first: the roster's week starts on Monday, so Sunday sits last.
    const firstWeekday = dayOfWeek(built[0].day);
    const leadingBlanks = (firstWeekday + 6) % 7;

    // Chunked into real weeks so the grid can declare `role="row"`. A `grid`
    // whose gridcells are not owned by rows is invalid ARIA — assistive tech
    // gets no table structure to traverse — and the flat CSS grid was exactly
    // that. The row wrappers use `display: contents`, so the seven-column
    // layout is unchanged; only the accessibility tree gains a level.
    const padded: Array<DayCell | null> = [...Array.from({ length: leadingBlanks }, () => null), ...built];
    while (padded.length % 7 !== 0) padded.push(null);
    const weeks: Array<Array<DayCell | null>> = [];
    for (let i = 0; i < padded.length; i += 7) weeks.push(padded.slice(i, i + 7));

    return { cells: built, weeks };
  }, [isWeek, weekStart, month, shifts, offers, showOvertime]);

  // One formatter for the whole grid. Constructing an `Intl.DateTimeFormat` is
  // the expensive half (~50-100us); `.format()` is cheap. This was an inline
  // closure rebuilt every render and called two or three times per shift plus
  // twice per offer row, so a month of shifts rebuilt ~60 formatters on every
  // claim, every leave change and every parent re-render.
  const timeFormat = useMemo(
    () => new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true }),
    [tz],
  );
  const formatTime = useCallback((ms: number) => timeFormat.format(new Date(ms)), [timeFormat]);

  // `bare` drops the panel because the Full Schedule dialog is already a surface;
  // nesting one inside the other stacks two overlays and reads as a card in a card.
  const panel = bare ? className : cn('rounded-xl p-4', SURFACE, className);
  // Seven cells on one row have the height a month grid cannot spare, and the week
  // view is the one that has to hold a shift, its accounts and an offer at once.
  const cellMinHeight = isWeek ? 'min-h-[8.5rem]' : 'min-h-[4.75rem]';

  /**
   * The panel header, minus its one variable line.
   *
   * A function rather than JSX inline in the happy path because the loading and
   * error states need it too: dropping the week arrows while a week loads means
   * a second arrow press during the fetch has nothing to hit, and the header
   * reappearing afterwards shifts everything below it.
   */
  const header = (statusLine: ReactNode) => (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <div className="min-w-0">
        {!bare && <h2 className="text-sm font-semibold">My schedule</h2>}
        <div className={cn('text-xs text-zinc-400', !bare && 'mt-0.5')}>{statusLine}</div>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1">
        {isWeek && (
          <div className="flex items-center gap-1">
            <Button
              size="icon-sm"
              variant="ghost"
              onClick={() => setWeekStart(addDays(weekStart, -7))}
              aria-label={`Previous week, ${formatWeekLabel(addDays(weekStart, -7))}`}
            >
              <ChevronLeft aria-hidden />
            </Button>

            {/* aria-live so a screen reader hears the week change without the
                arrows stealing focus or announcing themselves twice — the same
                shape as `MonthPicker`, because it is the same gesture. */}
            <span className="min-w-[8.5rem] text-center text-sm font-medium tabular-nums" aria-live="polite">
              {formatWeekLabel(weekStart)}
            </span>

            <Button
              size="icon-sm"
              variant="ghost"
              onClick={() => setWeekStart(addDays(weekStart, 7))}
              aria-label={`Next week, ${formatWeekLabel(addDays(weekStart, 7))}`}
            >
              <ChevronRight aria-hidden />
            </Button>

            {/* No forward cap, unlike the salary month picker: a roster is
                published ahead, and next week is the most useful thing on it. */}
            {weekStart !== startOfWeek(today) && (
              <Button
                size="xs"
                variant="ghost"
                onClick={() => setWeekStart(startOfWeek(today))}
                className="ml-1 text-zinc-400"
              >
                This week
              </Button>
            )}
          </div>
        )}

        {headerAction}

        {onOpenFullSchedule && (
          <Button size="sm" onClick={onOpenFullSchedule}>
            <CalendarDays aria-hidden />
            Full Schedule
          </Button>
        )}
      </div>
    </div>
  );

  if (loading) {
    return (
      <div className={panel}>
        {header(<Skeleton className="h-3.5 w-40 rounded" />)}
        <div className="grid grid-cols-7 gap-1">
          {Array.from({ length: isWeek ? 7 : 35 }).map((_, index) => (
            <Skeleton key={index} className={cn('rounded-md', isWeek ? 'h-32' : 'h-16')} />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={panel}>
        {header(<span className="text-red-400">{error}</span>)}
        <Button size="sm" variant="outline" onClick={() => void refetch()}>
          <RotateCcw className="size-3.5" aria-hidden />
          Try again
        </Button>
      </div>
    );
  }

  // Counted from the cells, not from the raw lists: the fetch window is padded a
  // day at each end, so those include occurrences from the neighbouring months
  // that this grid never draws.
  const totalShifts = cells.reduce((sum, cell) => sum + cell.shifts.length, 0);
  const totalOffers = cells.reduce((sum, cell) => sum + cell.offers.length, 0);

  const scopeLabel = isWeek ? formatWeekLabel(weekStart) : formatMonthLabel(month);

  return (
    <div className={panel}>
      {header(
        <>
          {totalShifts === 0 ? 'No shifts scheduled' : pluralise(totalShifts, 'shift')} · times in your timezone
        </>,
      )}

      <div
        className="grid grid-cols-7 gap-1"
        role="grid"
        aria-label={`Shift calendar for ${scopeLabel}`}
      >
        <div role="row" className="contents">
          {WEEKDAY_LABELS.map(label => (
            <div key={label} role="columnheader" className="pb-1 text-center text-[11px] font-medium text-zinc-400">
              {label}
            </div>
          ))}
        </div>

        {weeks.map((week, weekIndex) => (
          <div key={`week-${weekIndex}`} role="row" className="contents">
            {week.map((cell, dayIndex) => {
              if (!cell) return <div key={`blank-${weekIndex}-${dayIndex}`} role="gridcell" aria-hidden />;
              const isToday = cell.day === today;
              const hasShift = cell.shifts.length > 0;

              return (
                <div
                  key={cell.day}
                  role="gridcell"
                  className={cn(
                    cellMinHeight,
                    'rounded-md border p-1.5 transition-colors duration-[120ms]',
                    hasShift ? 'border-white/[0.07] bg-white/[0.03]' : 'border-transparent',
                    isToday && 'border-action-blue/40 bg-action-blue/[0.08]',
                  )}
                >
                  <span
                    className={cn(
                      'block text-[11px] tabular-nums',
                      isToday ? 'font-semibold text-action-blue' : 'text-zinc-400',
                    )}
                  >
                    {/* A week can straddle a month boundary, where a bare "1"
                        says nothing about which month it is the 1st of. The
                        month grid never has that ambiguity, so it keeps the
                        number alone. */}
                    {isWeek && cell.date === 1 ? formatDayLabel(cell.day) : cell.date}
                  </span>

                  {/* ── Primary: the agent's own shifts ── */}
                  {cell.shifts.map(shift => {
                    const isOvertime = shift.isOvertime ?? false;
                    const paysWage = shift.paysWage ?? true;
                    const ids = shift.creatorIds ?? [];
                    // Accounts on this shift marked overtime. What that means
                    // depends on what sits beside them: alongside regular
                    // accounts they are worked for the sales only, and on a
                    // shift that is nothing else they simply mark the shift as
                    // overtime — it pays on them like any other.
                    const split = splitShiftAccounts(ids, shift.overtimeCreatorIds);
                    const overtimeIds = split.overtimeIds;
                    const paidCount = split.paidIds.length;
                    const fullOvertime = split.isFullyOvertime;

                    const leave = leaveByOccurrence.get(occurrenceKey(shift)) ?? null;
                    // Offered right up until the shift starts. The 4-day notice is
                    // guidance, not a gate — an agent who is ill tomorrow still has
                    // to tell someone, and refusing the request only moves that
                    // conversation somewhere nobody can see it. Not offered on an
                    // in-shift cover: there are no hours of its own to take off.
                    const canRequestLeave = paysWage && !leave && shift.occurrenceStart > now;
                    // The cap the salary page tells the agent about, in hours.
                    const shiftHours = (shift.occurrenceEnd - shift.occurrenceStart) / 3_600_000;

                    return (
                      <div
                        key={`${shift.shiftId}-${shift.occurrenceStart}`}
                        className="group/shift mt-1"
                      >
                        {/* An in-shift cover has no hours of its own, so showing a
                            time for it would misrepresent what it pays. */}
                        {paysWage ? (
                          <span className="flex items-center gap-0.5 text-[11px] tabular-nums text-zinc-300">
                            {(isOvertime || fullOvertime) && (
                              <Plus className="size-2.5 shrink-0 text-orange-400" aria-hidden />
                            )}
                            {/* Start *and* length. Hours are capped at the shift's
                                scheduled length, so a start time alone left the figure
                                that sets the wage invisible anywhere in the product —
                                while the offers layer below already showed a window.
                                The full range does not fit ~90px, and the length is the
                                half that decides pay; the exact end goes to the screen
                                reader rather than being dropped. The Clock icon went to
                                buy the room. */}
                            {/* Two elements, not one truncating string. At the
                                1024px window floor a cell has ~80px and the pair
                                overflows, so a single `truncate` clipped the tail —
                                which is the length, the half that decides pay. The
                                length now holds its width and the start time gives
                                way first. */}
                            <span className="min-w-0 truncate">{formatTime(shift.occurrenceStart)}</span>
                            <span className="shrink-0 text-zinc-400">{`· ${formatHours(shiftHours)}`}</span>
                            <span className="sr-only">
                              {formatTime(shift.occurrenceStart)} – {formatTime(shift.occurrenceEnd)}
                            </span>

                            {canRequestLeave && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setLeaveTarget({
                                        shiftId: shift.shiftId,
                                        occurrenceStart: shift.occurrenceStart,
                                      })
                                    }
                                    aria-label={`Request time off for ${formatDayLabelWithWeekday(cell.day)}`}
                                    className={cn(
                                      'ml-auto shrink-0 rounded-sm p-0.5 text-zinc-500 transition-colors duration-[120ms]',
                                      'hover:bg-white/[0.08] hover:text-zinc-300',
                                      // Revealed on hover, but always present to the
                                      // keyboard — a hover-only control is invisible
                                      // to it otherwise (DESIGN.md §5).
                                      'opacity-0 group-hover/shift:opacity-100 focus-visible:opacity-100',
                                      'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                                    )}
                                  >
                                    <CalendarX2 className="size-3" aria-hidden />
                                  </button>
                                </TooltipTrigger>
                                <TooltipContent>Request time off</TooltipContent>
                              </Tooltip>
                            )}
                          </span>
                        ) : (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span
                                tabIndex={0}
                                className="flex cursor-help items-center gap-0.5 rounded-sm text-[11px] text-orange-400 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                              >
                                <Plus className="size-2.5 shrink-0" aria-hidden />
                                Cover
                                <span className="sr-only">{IN_SHIFT_COVER_EXPLANATION}</span>
                              </span>
                            </TooltipTrigger>
                            <TooltipContent className="max-w-56 text-center leading-relaxed">
                              {IN_SHIFT_COVER_EXPLANATION}
                            </TooltipContent>
                          </Tooltip>
                        )}

                        {/* Avatars only: a month grid cell is far too narrow for
                            names, and the picture is the faster recognition anyway.
                            Ringed faces are overtime — the ring is the only mark
                            that survives at this width, and the line below says
                            what it means so the colour is not decoration. */}
                        <div className="mt-0.5">
                          <CreatorChipList
                            creatorIds={ids}
                            // The raw field rather than `split.overtimeIds`:
                            // the list only tests membership, and a new array
                            // each render would defeat its memo.
                            overtimeIds={shift.overtimeCreatorIds}
                            max={4}
                            size="xs"
                            avatarOnly
                            emptyLabel={paysWage ? 'No accounts yet' : undefined}
                          />
                        </div>

                        {paysWage && overtimeIds.length > 0 && !fullOvertime && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span
                                tabIndex={0}
                                className="mt-0.5 flex cursor-help items-center gap-0.5 rounded-sm text-[10px] text-orange-400 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                              >
                                <Plus className="size-2.5 shrink-0" aria-hidden />
                                {overtimeIds.length} overtime
                                <span className="sr-only">
                                  {IN_SHIFT_OVERTIME_EXPLANATION} Paid on {paidCount} account
                                  {paidCount === 1 ? '' : 's'}.
                                </span>
                              </span>
                            </TooltipTrigger>
                            <TooltipContent className="max-w-56 text-center leading-relaxed">
                              {IN_SHIFT_OVERTIME_EXPLANATION}
                            </TooltipContent>
                          </Tooltip>
                        )}

                        {paysWage && fullOvertime && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span
                                tabIndex={0}
                                className="mt-0.5 flex cursor-help items-center gap-0.5 rounded-sm text-[10px] text-orange-400 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                              >
                                Overtime shift
                                <span className="sr-only">{FULL_OVERTIME_EXPLANATION}</span>
                              </span>
                            </TooltipTrigger>
                            <TooltipContent className="max-w-56 text-center leading-relaxed">
                              {FULL_OVERTIME_EXPLANATION}
                            </TooltipContent>
                          </Tooltip>
                        )}

                        {leave && (
                          <LeaveBadge
                            leave={leave}
                            onCancel={async () => {
                              try {
                                await cancelLeave(leave.leaveId);
                                toast.success('Leave request cancelled');
                              } catch (err) {
                                toast.error(err instanceof Error ? err.message : 'Could not cancel');
                              }
                            }}
                          />
                        )}
                      </div>
                    );
                  })}

                  {/* ── Secondary: overtime going spare ──
                      Always below the day's own shifts and visually quieter, so the
                      roster still reads first. */}
                  {cell.offers.length > 0 && (
                    <div className={cn(hasShift ? 'mt-1.5 border-t border-dashed border-white/[0.09] pt-1' : 'mt-1')}>
                      <OfferCell day={cell.day} offers={cell.offers} formatTime={formatTime} onClaim={setClaim} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {/* One quiet line rather than a legend nobody reads. */}
      <p className="mt-3 text-xs text-zinc-400">
        Select the <CalendarX2 className="inline size-3.5 align-[-3px]" aria-hidden /> on a shift to request time off.
        Leave not requested at least {MIN_LEAVE_NOTICE_DAYS} days in advance may be rejected.
      </p>

      {showOvertime && (
        <p className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-zinc-400">
          <span className="inline-block size-1.5 shrink-0 rounded-full bg-orange-400" aria-hidden />
          {offersLoading && totalOffers === 0
            ? 'Checking for available overtime…'
            : totalOffers === 0
              ? `No overtime available ${isWeek ? 'this week' : 'this month'}. Accounts appear here when someone’s leave is approved.`
              : `${pluralise(totalOffers, 'account')} available to cover — select one to claim it.`}
        </p>
      )}

      {totalShifts === 0 && !showOvertime && (
        <p className="mt-3 text-sm text-zinc-400">
          {isWeek ? 'Nothing scheduled this week.' : 'Nothing scheduled this month.'}
        </p>
      )}

      <RequestLeaveDialog
        target={leaveTarget}
        onClose={() => setLeaveTarget(null)}
        onSubmit={async (leaveType, reason) => {
          if (!leaveTarget) return;
          // No `refetch` afterwards: `requestLeave` already invalidates the cache
          // and reloads, and the reload now reaches every mounted consumer. The
          // extra call here was a second identical round-trip per request.
          await requestLeave(leaveTarget.shiftId, leaveTarget.occurrenceStart, leaveType, reason);
        }}
      />
    </div>
  );
}

/**
 * `'15 – 21 Sep'`, or `'29 Sep – 5 Oct'` when the week straddles a month.
 *
 * The year is left off: the arrows move a week at a time from today, so the one
 * thing nobody is ever unsure of is which year they are in — and the label has to
 * sit between two arrows in a panel header.
 */
function formatWeekLabel(weekStart: string): string {
  const end = addDays(weekStart, 6);
  return monthOfDay(weekStart) === monthOfDay(end)
    ? `${Number(weekStart.slice(8, 10))} – ${formatDayLabel(end)}`
    : `${formatDayLabel(weekStart)} – ${formatDayLabel(end)}`;
}

// ─── Leave status on a shift ─────────────────────────────────────────

const LEAVE_STATUS_STYLE: Record<LeaveRequest['status'], string> = {
  pending: 'text-orange-400',
  approved: 'text-green-400',
  denied: 'text-red-400',
};

/**
 * What happened to a leave request, in a cell that has ~90px to say it.
 *
 * A pending request can still be withdrawn, so it carries its own cancel; a
 * resolved one is just a state.
 *
 * The label states the status in words. It used to read `Off?` / `Off` / `Denied`,
 * which made one character of punctuation the difference between "your time off is
 * approved" and "we have not decided" — with the real words reachable only by
 * hovering a non-focusable span. The tooltip now reinforces rather than carries,
 * and the leave *type* and reason are what the announced detail adds.
 */
function LeaveBadge({ leave, onCancel }: { leave: LeaveRequest; onCancel: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);

  // Whether someone's time off is approved is not supplementary information, and
  // `Off?` versus `Off` is one character of difference. Until the visible label
  // itself is reworked, the full state is announced rather than left to a hover.
  const label =
    leave.status === 'pending' ? 'Off — pending' : leave.status === 'approved' ? 'Off' : 'Off — denied';

  const fullState = `${leave.leaveType === 'paid' ? 'Paid' : 'Unpaid'} leave · ${leave.status}${
    leave.reason ? ` — ${leave.reason}` : ''
  }`;

  // The visible label now carries the status, so the announced detail adds only
  // what it does not say rather than repeating it.
  const announcedDetail = `${leave.leaveType === 'paid' ? 'Paid' : 'Unpaid'} leave${
    leave.reason ? ` — ${leave.reason}` : ''
  }`;

  return (
    <span className="mt-0.5 flex min-w-0 flex-wrap items-center gap-0.5">
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            tabIndex={0}
            className={cn(
              'cursor-help rounded-sm text-[11px] font-medium focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
              LEAVE_STATUS_STYLE[leave.status],
            )}
          >
            {label}
            <span className="sr-only"> · {announcedDetail}</span>
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-56 text-center leading-relaxed">{fullState}</TooltipContent>
      </Tooltip>

      {leave.status === 'pending' && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await onCancel();
                } finally {
                  setBusy(false);
                }
              }}
              aria-label="Withdraw this leave request"
              className={cn(
                'shrink-0 rounded-sm p-0.5 text-zinc-500 transition-colors duration-[120ms]',
                'hover:bg-white/[0.08] hover:text-zinc-300',
                'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
              )}
            >
              {busy ? (
                <Loader2Icon className="activity-spinner size-2.5" aria-hidden />
              ) : (
                <X className="size-2.5" aria-hidden />
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent>Withdraw request</TooltipContent>
        </Tooltip>
      )}
    </span>
  );
}

// ─── Overtime in a day cell ──────────────────────────────────────────

/**
 * The day's available cover, and the claim interaction.
 *
 * A popover rather than an inline button, because a month cell is ~90px wide and
 * claiming needs context the cell cannot hold: which creator, whose absence, what
 * hours, and whether anyone else is already in for it. The cell carries the count
 * and the faces; the popover carries the decision.
 */
function OfferCell({
  day,
  offers,
  formatTime,
  onClaim,
}: {
  day: string;
  offers: CoverageOfferRow[];
  formatTime: (ms: number) => string;
  onClaim: (offerId: string, claimed: boolean) => Promise<void>;
}) {
  const [busy, setBusy] = useState<string | null>(null);

  const mine = offers.filter(o => o.myClaim).length;
  // Stable identity, so the memoised chip list is not rebuilt on every render of
  // the calendar (a claim landing re-renders every cell).
  const offerCreatorIds = useMemo(() => offers.map(o => o.creatorId), [offers]);

  async function toggle(offer: CoverageOfferRow) {
    setBusy(offer.offerId);
    try {
      const claiming = !offer.myClaim;
      await onClaim(offer.offerId, claiming);
      toast.success(
        claiming ? `You're in for ${offer.creatorName} on ${formatDayLabelWithWeekday(day)}` : 'Claim withdrawn',
      );
    } catch (err) {
      // The server's message names the limit that was hit — the account cap, the
      // notice period — which is the only useful thing to say here.
      toast.error(err instanceof Error ? err.message : 'Could not update your claim');
    } finally {
      setBusy(null);
    }
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'flex w-full items-center gap-1 rounded-sm px-0.5 py-px text-left transition-colors duration-[120ms]',
            'hover:bg-white/[0.055] active:bg-white/[0.08]',
            'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/50',
          )}
          aria-label={`${pluralise(offers.length, 'account')} available to cover on ${formatDayLabelWithWeekday(day)}`}
        >
          <span
            className={cn('inline-block size-1.5 shrink-0 rounded-full', mine > 0 ? 'bg-green-400' : 'bg-orange-400')}
            aria-hidden
          />
          <span
            className={cn('shrink-0 text-[11px] font-medium', mine > 0 ? 'text-green-400' : 'text-orange-400')}
          >
            {mine > 0 ? `In for ${mine}` : `+${offers.length}`}
          </span>
          <CreatorChipList creatorIds={offerCreatorIds} max={2} size="xs" avatarOnly />
        </button>
      </PopoverTrigger>

      <PopoverContent align="start" className="w-72 p-0">
        <div className="border-b border-white/[0.07] px-3 py-2">
          <p className="text-sm font-semibold">Overtime available</p>
          <p className="mt-0.5 text-xs text-zinc-400">{formatDayLabelWithWeekday(day)}</p>
        </div>

        <ul className="max-h-72 divide-y divide-white/[0.07] overflow-y-auto">
          {offers.map(offer => (
            <li key={offer.offerId} className="px-3 py-2.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <CreatorChip creatorId={offer.creatorId} name={offer.creatorName} />
                  <p className="mt-1 text-xs tabular-nums text-zinc-400">
                    {formatTime(offer.windowStart)} – {formatTime(offer.windowEnd)}
                  </p>
                  {offer.originalUserName && (
                    <p className="mt-0.5 text-xs text-zinc-400">Covering {offer.originalUserName}</p>
                  )}
                  {offer.claimCount > 0 && (
                    <p className="mt-0.5 flex items-center gap-1 text-xs text-zinc-400">
                      <Users className="size-3" aria-hidden />
                      <span className="tabular-nums">{offer.claimCount}</span> in so far
                    </p>
                  )}
                </div>

                <Button
                  size="xs"
                  variant={offer.myClaim ? 'outline' : 'default'}
                  disabled={busy === offer.offerId}
                  onClick={() => void toggle(offer)}
                  className={cn(
                    'shrink-0',
                    offer.myClaim && 'border-green-500/30 bg-green-500/10 text-green-400 hover:bg-green-500/15',
                  )}
                >
                  {busy === offer.offerId && <Loader2Icon className="activity-spinner size-3" aria-hidden />}
                  {offer.myClaim ? (
                    <>
                      <Check aria-hidden />
                      In
                    </>
                  ) : (
                    'Claim'
                  )}
                </Button>
              </div>
            </li>
          ))}
        </ul>

        <p className="border-t border-white/[0.07] px-3 py-2 text-xs leading-relaxed text-zinc-400">
          Claiming puts your name forward. An admin confirms who covers what.
        </p>
      </PopoverContent>
    </Popover>
  );
}
