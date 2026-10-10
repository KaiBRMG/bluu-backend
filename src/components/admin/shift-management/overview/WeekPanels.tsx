'use client';

import { useMemo } from 'react';
import { ArrowRight, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { SURFACE } from '@/lib/surfaces';
import type { AnalyticsData } from '@/hooks/useAnalyticsData';
import {
  STATUS_ABSENT,
  STATUS_LATE,
  STATUS_ON_TIME,
  formatDateShort,
  formatDuration,
  formatPercent,
} from '../analytics/analyticsTypes';
import { PersonAvatar } from './personUi';

/**
 * The period half of the Overview: the last seven settled days, from the same
 * nightly rollups the Analytics view reads (one request, shared by both panels).
 * Range-independent on purpose — it answers "how did the team do this week"
 * before anyone picks a filter (DESIGN.md — metric roster, standing stat row).
 */

function Stat({ label, value, meta }: { label: string; value: string; meta: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2.5">
      <dt className="min-w-0">
        <div className="text-sm">{label}</div>
        <div className="mt-0.5 text-[11px] text-zinc-400 tabular-nums">{meta}</div>
      </dt>
      <dd className="shrink-0 text-base font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

export function WeekSummary({
  data,
  loading,
  error,
  onOpenAnalytics,
}: {
  data: AnalyticsData | null;
  loading: boolean;
  error: string | null;
  onOpenAnalytics: () => void;
}) {
  const a = data?.adherence;
  const t = data?.totals;
  const w = data?.wellbeing;
  const maxDay = useMemo(
    () => Math.max(1, ...(a?.byDate ?? []).map(d => d.onTime + d.late + d.absent)),
    [a],
  );

  return (
    <section aria-labelledby="week-title" className={`rounded-xl px-4 pt-4 pb-3 ${SURFACE}`}>
      <header className="flex items-baseline justify-between gap-2">
        <h2 id="week-title" className="text-sm font-semibold">Last 7 days</h2>
        {data && (
          <span className="text-[11px] tabular-nums text-zinc-400">
            {formatDateShort(data.range.start)} – {formatDateShort(data.range.end)}
          </span>
        )}
      </header>

      {loading ? (
        <div className="mt-3 space-y-3" aria-hidden>
          {[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-9 w-full rounded-md" />)}
        </div>
      ) : error ? (
        <p className="mt-3 text-sm text-zinc-400">Couldn&apos;t load the week: {error}</p>
      ) : !data || !t || !a || !w || data.meta.rollupCount === 0 ? (
        <p className="mt-3 text-sm text-zinc-400">No tracked time in the last 7 days.</p>
      ) : (
        <>
          <dl className="mt-1 divide-y divide-white/[0.07]">
            <Stat
              label="Worked"
              value={formatDuration(t.workingSeconds + t.breakSeconds)}
              meta={`${t.activeUserCount} ${t.activeUserCount === 1 ? 'person' : 'people'} · ${t.avgDayWorkingSeconds !== null ? `${formatDuration(t.avgDayWorkingSeconds)} a day each` : 'no full days'}`}
            />
            <Stat
              label="Rostered hours covered"
              value={formatPercent(a.coverageRatio)}
              meta={`${formatDuration(a.workedInShiftSeconds)} of ${formatDuration(a.scheduledSeconds)} scheduled`}
            />
            <div className="py-2.5">
              <div className="flex items-baseline justify-between gap-4">
                <div>
                  <div className="text-sm">On time</div>
                  <div className="mt-0.5 text-[11px] text-zinc-400 tabular-nums">
                    {a.onTime} on time · {a.late} late · {a.absent} missed
                  </div>
                </div>
                <div className="text-base font-semibold tabular-nums">{formatPercent(a.punctuality)}</div>
              </div>
              {/* One column per day: shifts stacked by outcome. The counts above
                  carry the same facts in text, so colour is never the only route. */}
              <div className="mt-2 flex h-8 items-end gap-1" role="img" aria-label={a.byDate.map(d => `${formatDateShort(d.date)}: ${d.onTime} on time, ${d.late} late, ${d.absent} missed`).join('; ')}>
                {a.byDate.map(d => {
                  const total = d.onTime + d.late + d.absent;
                  return (
                    <div key={d.date} className="flex h-full flex-1 flex-col justify-end" title={formatDateShort(d.date)}>
                      {total === 0 ? (
                        <span className="h-px w-full bg-white/[0.15]" />
                      ) : (
                        <div className="flex w-full flex-col-reverse overflow-hidden rounded-[2px]" style={{ height: `${(total / maxDay) * 100}%` }}>
                          <span style={{ flexGrow: d.onTime, background: STATUS_ON_TIME }} />
                          <span style={{ flexGrow: d.late, background: STATUS_LATE }} />
                          <span style={{ flexGrow: d.absent, background: STATUS_ABSENT }} />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
            <Stat
              label="Breaks"
              value={`${w.noBreakDays}`}
              meta={`days worked without one · ${w.usersOverAllowance} over allowance`}
            />
            <Stat
              label="Outside shifts"
              value={formatDuration(a.unrosteredOvertimeSeconds)}
              meta="clocked time no shift covered"
            />
          </dl>
          <p className="mt-1 text-[11px] text-zinc-400">
            Computed nightly, so it ends yesterday
            {data.meta.provisionalDays > 0 && ` · ${data.meta.provisionalDays} day${data.meta.provisionalDays === 1 ? '' : 's'} still provisional`}
          </p>
        </>
      )}

      <Button variant="ghost" size="sm" className="mt-2 -ml-2 text-zinc-300" onClick={onOpenAnalytics}>
        Full analytics <ArrowRight />
      </Button>
    </section>
  );
}

export function TeamWeek({
  data,
  loading,
  onOpen,
}: {
  data: AnalyticsData | null;
  loading: boolean;
  onOpen: (uid: string) => void;
}) {
  // A–Z: a known name is found by position (DESIGN.md — sort for retrieval).
  const rows = useMemo(
    () => [...(data?.byUser ?? [])].sort((a, b) => a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' })),
    [data],
  );

  return (
    <section aria-labelledby="team-title" className={`rounded-xl ${SURFACE}`}>
      <header className="flex items-baseline gap-3 px-4 pt-4 pb-2">
        <h2 id="team-title" className="text-sm font-semibold">Timesheets, last 7 days</h2>
        {data && <span className="text-[11px] tabular-nums text-zinc-400">{rows.length} people</span>}
      </header>

      {loading ? (
        <div className="space-y-2 px-4 pb-4" aria-hidden>
          {[0, 1, 2, 3, 4].map(i => <Skeleton key={i} className="h-9 w-full rounded-md" />)}
        </div>
      ) : rows.length === 0 ? (
        <p className="px-4 pb-5 text-sm text-zinc-400">No one tracked time in the last 7 days.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="border-white/[0.07] hover:bg-transparent">
              <TableHead className="pl-4">Person</TableHead>
              <TableHead className="text-right">Worked</TableHead>
              <TableHead className="text-right">Days</TableHead>
              <TableHead className="text-right">On time</TableHead>
              <TableHead className="text-right">Late</TableHead>
              <TableHead className="text-right">Missed</TableHead>
              <TableHead className="text-right">No-break days</TableHead>
              <TableHead className="pr-4 text-right">
                <span className="inline-flex items-center gap-1">
                  Activity
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button type="button" aria-label="About activity" className="text-zinc-400 hover:text-white">
                        <Info className="size-3" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-64 text-center leading-relaxed">
                      Share of screenshot intervals with keyboard or mouse input. It measures input, not output — reading and calls count as inactive.
                    </TooltipContent>
                  </Tooltip>
                </span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(u => (
              <TableRow
                key={u.userId}
                className="cursor-pointer border-white/[0.07] hover:bg-white/[0.055] active:bg-white/[0.08]"
                onClick={() => onOpen(u.userId)}
              >
                <TableCell className="pl-4">
                  <button
                    type="button"
                    className="flex items-center gap-2 rounded-sm text-left focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    onClick={e => { e.stopPropagation(); onOpen(u.userId); }}
                  >
                    <PersonAvatar displayName={u.displayName} photoURL={u.photoURL} />
                    <span className="text-sm hover:underline underline-offset-2">{u.displayName}</span>
                  </button>
                </TableCell>
                <TableCell className="text-right tabular-nums">{formatDuration(u.workingSeconds + u.breakSeconds)}</TableCell>
                <TableCell className="text-right tabular-nums">{u.daysWorked}</TableCell>
                <TableCell className="text-right tabular-nums">{formatPercent(u.punctuality)}</TableCell>
                <TableCell className={`text-right tabular-nums ${u.lateCount > 0 ? 'text-yellow-400' : 'text-zinc-400'}`}>{u.lateCount}</TableCell>
                <TableCell className={`text-right tabular-nums ${u.absentCount > 0 ? 'text-red-400' : 'text-zinc-400'}`}>{u.absentCount}</TableCell>
                <TableCell className={`text-right tabular-nums ${u.noBreakDays > 0 ? 'text-orange-400' : 'text-zinc-400'}`}>{u.noBreakDays}</TableCell>
                <TableCell className="pr-4 text-right tabular-nums text-zinc-300">
                  {u.activityMean !== null ? `${Math.round(u.activityMean)}%` : '—'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}
