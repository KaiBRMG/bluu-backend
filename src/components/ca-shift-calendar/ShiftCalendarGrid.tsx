'use client';

import { memo, useMemo } from 'react';
import { Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';
import { CreatorAvatar } from '@/components/creators/CreatorChip';
import { getAvatarColor, getInitials } from '@/lib/utils/avatar';
import { safeTimezone } from '@/lib/utils/timezone';
import { splitShiftAccounts } from '@/lib/salary/shiftAccounts';
import { formatDuration, type AccountWeek, type CoverageShift, type DayCoverage } from '@/lib/shiftCoverage';
import type { Creator } from '@/lib/campaignTracking';
import type { CalendarPerson, CalendarShift } from '@/hooks/useCaShiftCalendar';

/**
 * The Shift Calendar grid: creators as rows, days as columns — the Shift
 * Management schedule turned around.
 *
 * Each cell lists the agents on that account that day and carries a 24-hour
 * strip under them: grey where somebody is on, orange where nobody is. The
 * hours are also written out, because a coloured bar alone says nothing to a
 * screen reader or a colour-blind reader. A gap in the past is neutral — it is
 * history, nothing to act on — so orange only ever means "still to fill".
 *
 * Agents are greyscale on purpose: Schedule colours each agent, which across
 * forty creator rows turns into a rainbow. The face identifies them here.
 */

const DAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MAX_LINES = 3;

export interface GridRow {
  account: Creator;
  week: AccountWeek;
  /** Uncovered ms still ahead of now (or in the whole week, if it is over). */
  upcomingGapMs: number;
}

interface Props {
  rows: GridRow[];
  weekDays: string[];
  today: string;
  now: number;
  timezone: string;
  people: Map<string, CalendarPerson>;
  viewerUid: string | null;
  canEdit: boolean;
  onAdd: (accountId: string, day: string) => void;
  onOpenShift: (shift: CalendarShift) => void;
}

function formatTime(ms: number, tz: string): string {
  return new Date(ms).toLocaleTimeString('en-GB', { timeZone: safeTimezone(tz), hour: '2-digit', minute: '2-digit', hour12: false });
}

function dayLabel(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

/** What the line says about when: the window, or which edge of the day it crosses. */
function whenLabel(shift: CoverageShift, day: DayCoverage, tz: string): string {
  const startsBefore = shift.occurrenceStart < day.dayStart;
  const endsAfter = shift.occurrenceEnd > day.dayEnd;
  if (startsBefore && endsAfter) return 'All day';
  if (startsBefore) return `until ${formatTime(shift.occurrenceEnd, tz)}`;
  if (endsAfter) return `from ${formatTime(shift.occurrenceStart, tz)}`;
  return `${formatTime(shift.occurrenceStart, tz)}–${formatTime(shift.occurrenceEnd, tz)}`;
}

function CoverageStrip({ day, past }: { day: DayCoverage; past: boolean }) {
  const span = day.dayEnd - day.dayStart;
  const pct = (ms: number) => `${((ms - day.dayStart) / span) * 100}%`;
  const hasGap = day.gapMs >= 60_000;
  return (
    <div
      className={cn('relative mt-1.5 h-1 overflow-hidden rounded-full', hasGap ? (past ? 'bg-white/[0.08]' : 'bg-orange-400/70') : 'bg-white/45')}
      role={hasGap ? 'img' : undefined}
      aria-label={hasGap ? `${formatDuration(day.gapMs)} uncovered` : undefined}
      aria-hidden={hasGap ? undefined : true}
    >
      {hasGap &&
        day.covered.map(iv => (
          <span
            key={iv.start}
            className="absolute inset-y-0 bg-white/45"
            style={{ left: pct(iv.start), width: `${((iv.end - iv.start) / span) * 100}%` }}
          />
        ))}
    </div>
  );
}

const Cell = memo(function Cell({
  account, day, isToday, past, tz, people, viewerUid, canEdit, onAdd, onOpenShift,
}: {
  account: Creator;
  day: DayCoverage;
  isToday: boolean;
  past: boolean;
  tz: string;
  people: Map<string, CalendarPerson>;
  viewerUid: string | null;
  canEdit: boolean;
  onAdd: (accountId: string, day: string) => void;
  onOpenShift: (shift: CalendarShift) => void;
}) {
  const shown = day.shifts.slice(0, MAX_LINES);
  const hidden = day.shifts.length - shown.length;
  const hasGap = day.gapMs >= 60_000;

  return (
    <td
      className={cn(
        'group/cell relative h-[68px] min-w-[140px] border-r border-white/[0.06] p-1.5 align-top',
        isToday && 'bg-white/[0.025]',
        canEdit && 'cursor-pointer hover:bg-white/[0.04]',
      )}
      onClick={canEdit ? e => { if (!(e.target as HTMLElement).closest('[data-shift-line]')) onAdd(account.creatorID, day.day); } : undefined}
    >
      <div className="space-y-0.5">
        {shown.map(s => {
          const cs = s as CalendarShift;
          const person = people.get(s.userId);
          const name = person?.displayName ?? s.userId;
          const mine = viewerUid !== null && s.userId === viewerUid;
          const split = splitShiftAccounts(cs.creatorIds, cs.overtimeCreatorIds);
          const overtime = !!cs.isOvertime || split.isFullyOvertime || split.overtimeIds.includes(account.creatorID);
          const when = whenLabel(s, day, tz);
          const body = (
            <>
              <Avatar className="size-4 shrink-0">
                {person?.photoURL && <AvatarImage src={person.photoURL} alt="" />}
                <AvatarFallback className="text-[8px] font-medium text-white" style={{ background: getAvatarColor(name || 'User') }}>
                  {getInitials(name)}
                </AvatarFallback>
              </Avatar>
              <span className={cn('min-w-0 flex-1 truncate text-[11px]', mine ? 'font-semibold text-white' : 'font-medium text-zinc-300')}>
                {mine ? 'You' : name.split(' ')[0]}
              </span>
              {overtime && (
                <span className="text-[9px] font-semibold text-orange-400" title="Overtime">OT</span>
              )}
              <span className="shrink-0 text-[10px] tabular-nums text-zinc-400">{when}</span>
            </>
          );
          const lineClass = cn(
            'flex w-full items-center gap-1 rounded-md px-1 py-0.5 text-left',
            mine ? 'bg-action-blue/[0.08] ring-1 ring-inset ring-action-blue/30' : 'bg-white/[0.04]',
          );
          return canEdit ? (
            <button
              key={cs.shiftId + cs.occurrenceStart}
              type="button"
              data-shift-line
              title={`${name}, ${formatTime(s.occurrenceStart, tz)}–${formatTime(s.occurrenceEnd, tz)}`}
              onClick={() => onOpenShift(cs)}
              className={cn(lineClass, 'hover:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action-blue')}
            >
              {body}
            </button>
          ) : (
            <div key={cs.shiftId + cs.occurrenceStart} title={`${name}, ${formatTime(s.occurrenceStart, tz)}–${formatTime(s.occurrenceEnd, tz)}`} className={lineClass}>
              {body}
            </div>
          );
        })}
        {hidden > 0 && (
          <div className="px-1 text-[10px] text-zinc-400" title={`${hidden} more shift${hidden === 1 ? '' : 's'} on ${account.stageName}`}>
            +{hidden} more
          </div>
        )}
      </div>

      <CoverageStrip day={day} past={past} />
      {hasGap && (
        <div className={cn('mt-0.5 text-[10px] tabular-nums', past ? 'text-zinc-400' : 'text-orange-400')}>
          {day.shifts.length === 0 ? 'Nobody on' : `${formatDuration(day.gapMs)} uncovered`}
        </div>
      )}

      {canEdit && (
        <button
          type="button"
          aria-label={`Add a shift for ${account.stageName} on ${dayLabel(day.day)}`}
          onClick={() => onAdd(account.creatorID, day.day)}
          className="absolute right-1 top-1 flex size-5 items-center justify-center rounded-md text-zinc-400 opacity-0 transition-opacity hover:bg-white/[0.08] hover:text-white focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action-blue group-hover/cell:opacity-100"
        >
          <Plus className="size-3" />
        </button>
      )}
    </td>
  );
});

export function ShiftCalendarGrid({
  rows, weekDays, today, now, timezone, people, viewerUid, canEdit, onAdd, onOpenShift,
}: Props) {
  const header = useMemo(() => weekDays.map((day, i) => ({ day, short: DAY_SHORT[i], label: dayLabel(day) })), [weekDays]);

  return (
    <div className="overflow-x-auto rounded-xl border border-white/[0.07]">
      <table className="w-full min-w-[1180px] table-fixed border-collapse">
        <caption className="sr-only">Shifts by creator account for the week; each day shows who is on and the hours nobody covers.</caption>
        <thead>
          <tr>
            <th scope="col" className="sticky left-0 z-10 w-[200px] border-b border-r border-white/[0.07] bg-background px-3 py-2 text-left text-[11px] font-semibold text-zinc-400">
              Creator
            </th>
            {header.map(h => {
              const isToday = h.day === today;
              return (
                <th
                  key={h.day}
                  scope="col"
                  aria-current={isToday ? 'date' : undefined}
                  className={cn(
                    'border-b border-r border-white/[0.07] px-2 py-2 text-center text-[11px] font-semibold',
                    isToday ? 'border-b-2 border-b-white bg-white/[0.06] text-white' : 'bg-black/15 text-zinc-400',
                  )}
                >
                  {h.short}
                  <span className="block text-[10px] font-normal">{h.label}</span>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ account, week, upcomingGapMs }) => (
            <tr key={account.creatorID} className="border-b border-white/[0.06] last:border-b-0">
              <th
                scope="row"
                className={cn(
                  'sticky left-0 z-10 border-r border-white/[0.07] bg-background px-3 py-2 text-left align-middle font-normal',
                  account.isSubAccount && 'pl-6',
                )}
              >
                <div className="flex min-w-0 items-center gap-2">
                  <CreatorAvatar creatorId={account.creatorID} className="size-7 text-[11px]" />
                  <div className="min-w-0">
                    <div className="truncate text-xs font-medium text-white" title={account.stageName}>
                      {account.stageName}
                      {account.isArchived && <span className="ml-1 text-[10px] font-normal text-zinc-400">Archived</span>}
                    </div>
                    {upcomingGapMs >= 60_000 && (
                      <div className="text-[10px] tabular-nums text-orange-400">{formatDuration(upcomingGapMs)} uncovered</div>
                    )}
                  </div>
                </div>
              </th>
              {week.days.map(d => (
                <Cell
                  key={d.day}
                  account={account}
                  day={d}
                  isToday={d.day === today}
                  past={d.dayEnd <= now}
                  tz={timezone}
                  people={people}
                  viewerUid={viewerUid}
                  canEdit={canEdit}
                  onAdd={onAdd}
                  onOpenShift={onOpenShift}
                />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Grid-shaped placeholder: the toolbar's height and a body the size of the real thing. */
export function ShiftCalendarSkeleton() {
  return <Skeleton className="h-[480px] w-full rounded-xl" />;
}
