'use client';

import { useEffect, useMemo, useState } from 'react';
import { CalendarX2, Check, Loader2Icon, Plus, RotateCcw, Users, X } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useShiftCalendar } from '@/hooks/useShiftCalendar';
import { useCoverageOffers, type CoverageOfferRow } from '@/hooks/useCoverageOffers';
import { useLeaveRequests, type LeaveRequest } from '@/hooks/useLeaveRequests';
import { RequestLeaveDialog, MIN_LEAVE_NOTICE_DAYS, type LeaveTarget } from './RequestLeaveDialog';
import { currentDayKey, daysInMonth, dayOfWeek, formatDayLabelWithWeekday, toDayKey } from '@/lib/salary/salaryDate';
import { formatHours, pluralise } from '@/lib/salary/salaryFormat';
import type { ExpandedShift } from '@/lib/utils/recurrence';
import { safeTimezone } from '@/lib/utils/timezone';
import { CreatorChip, CreatorChipList } from '@/components/creators/CreatorChip';

/**
 * The agent's month at a glance: which days they work, which accounts, and what
 * overtime is going spare.
 *
 * Built as a real month grid rather than an agenda list because the question it
 * answers is shaped like a month — "am I on next Tuesday", "how many days am I
 * covering Adam". An agenda answers "what's next", which the dashboard's shift
 * list already does.
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

interface ShiftCalendarProps {
  month: string;
  timezone: string;
  /** Render available overtime alongside the agent's own shifts. */
  showOvertime?: boolean;
  className?: string;
}

interface DayCell {
  day: string;
  date: number;
  shifts: ExpandedShift[];
  offers: CoverageOfferRow[];
}

export function ShiftCalendar({ month, timezone, showOvertime = false, className }: ShiftCalendarProps) {
  const { shifts, loading, error, refetch } = useShiftCalendar(month);
  const { offers, setClaim, loading: offersLoading } = useCoverageOffers({
    status: 'available',
    enabled: showOvertime,
  });

  const { leaveRequests, requestLeave, cancelLeave, refetch: refetchLeave } = useLeaveRequests();
  const [leaveTarget, setLeaveTarget] = useState<LeaveTarget | null>(null);

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
  const leaveByOccurrence = useMemo(() => {
    const map = new Map<string, LeaveRequest>();
    for (const request of leaveRequests) map.set(`${request.shiftId}:${request.occurrenceStart}`, request);
    return map;
  }, [leaveRequests]);

  const { cells, leadingBlanks } = useMemo(() => {
    const count = daysInMonth(month);

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

    const built: DayCell[] = [];
    for (let date = 1; date <= count; date++) {
      const key = `${month}-${String(date).padStart(2, '0')}`;
      built.push({
        day: key,
        date,
        shifts: shiftsByDay.get(key) ?? [],
        offers: offersByDay.get(key) ?? [],
      });
    }

    // Monday-first: the roster's week starts on Monday, so Sunday sits last.
    const firstWeekday = dayOfWeek(built[0].day);
    return { cells: built, leadingBlanks: (firstWeekday + 6) % 7 };
  }, [month, shifts, offers, showOvertime]);

  const formatTime = (ms: number) =>
    new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true }).format(
      new Date(ms),
    );

  if (loading) {
    return (
      <div className={cn('rounded-xl border border-white/[0.07] bg-white/[0.025] p-4', className)}>
        <Skeleton className="h-4 w-32 rounded" />
        <div className="mt-3 grid grid-cols-7 gap-1">
          {Array.from({ length: 35 }).map((_, index) => (
            <Skeleton key={index} className="h-16 rounded-md" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={cn('rounded-xl border border-white/[0.07] bg-white/[0.025] p-4', className)}>
        <p className="text-sm text-red-400">{error}</p>
        <Button size="sm" variant="outline" className="mt-3" onClick={() => void refetch()}>
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

  return (
    <div className={cn('rounded-xl border border-white/[0.07] bg-white/[0.025] p-4', className)}>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">My schedule</h2>
        <p className="text-xs text-zinc-400">
          {totalShifts === 0 ? 'No shifts scheduled' : pluralise(totalShifts, 'shift')} · times in your timezone
        </p>
      </div>

      <div className="grid grid-cols-7 gap-1" role="grid" aria-label={`Shift calendar for ${month}`}>
        {WEEKDAY_LABELS.map(label => (
          <div key={label} role="columnheader" className="pb-1 text-center text-[11px] font-medium text-zinc-400">
            {label}
          </div>
        ))}

        {Array.from({ length: leadingBlanks }).map((_, index) => (
          <div key={`blank-${index}`} aria-hidden />
        ))}

        {cells.map(cell => {
          const isToday = cell.day === today;
          const hasShift = cell.shifts.length > 0;

          return (
            <div
              key={cell.day}
              role="gridcell"
              className={cn(
                'min-h-[4.75rem] rounded-md border p-1.5 transition-colors duration-[120ms]',
                hasShift ? 'border-white/[0.07] bg-white/[0.03]' : 'border-transparent',
                isToday && 'border-[#3b82f6]/40 bg-[#3b82f6]/[0.08]',
              )}
            >
              <span
                className={cn(
                  'block text-[11px] tabular-nums',
                  isToday ? 'font-semibold text-[#3b82f6]' : 'text-zinc-400',
                )}
              >
                {cell.date}
              </span>

              {/* ── Primary: the agent's own shifts ── */}
              {cell.shifts.map(shift => {
                const isOvertime = shift.isOvertime ?? false;
                const paysWage = shift.paysWage ?? true;
                const ids = shift.creatorIds ?? [];

                const leave = leaveByOccurrence.get(`${shift.shiftId}:${shift.occurrenceStart}`) ?? null;
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
                        {isOvertime && <Plus className="size-2.5 shrink-0 text-orange-400" aria-hidden />}
                        {/* Start *and* length. Hours are capped at the shift's
                            scheduled length, so a start time alone left the figure
                            that sets the wage invisible anywhere in the product —
                            while the offers layer below already showed a window.
                            The full range does not fit ~90px, and the length is the
                            half that decides pay; the exact end goes to the screen
                            reader rather than being dropped. The Clock icon went to
                            buy the room. */}
                        <span className="truncate">
                          {formatTime(shift.occurrenceStart)}
                          <span className="text-zinc-400">
                            {' · '}
                            {formatHours(shiftHours)}
                          </span>
                        </span>
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
                                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3b82f6]',
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
                            className="flex cursor-help items-center gap-0.5 rounded-sm text-[11px] text-orange-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3b82f6]"
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
                        names, and the picture is the faster recognition anyway. */}
                    <div className="mt-0.5">
                      <CreatorChipList
                        creatorIds={ids}
                        max={4}
                        size="xs"
                        avatarOnly
                        emptyLabel={paysWage ? 'No accounts yet' : undefined}
                      />
                    </div>

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
              ? 'No overtime available this month. Accounts appear here when someone’s leave is approved.'
              : `${pluralise(totalOffers, 'account')} available to cover — select one to claim it.`}
        </p>
      )}

      {totalShifts === 0 && !showOvertime && (
        <p className="mt-3 text-sm text-zinc-400">Nothing scheduled this month.</p>
      )}

      <RequestLeaveDialog
        target={leaveTarget}
        onClose={() => setLeaveTarget(null)}
        onSubmit={async (leaveType, reason) => {
          if (!leaveTarget) return;
          await requestLeave(leaveTarget.shiftId, leaveTarget.occurrenceStart, leaveType, reason);
          await refetchLeave();
        }}
      />
    </div>
  );
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
              'cursor-help rounded-sm text-[11px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3b82f6]',
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
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3b82f6]',
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
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#3b82f6]',
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
