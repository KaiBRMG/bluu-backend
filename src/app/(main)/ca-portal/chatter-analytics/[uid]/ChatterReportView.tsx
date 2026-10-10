'use client';

import { Fragment, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { format } from 'date-fns';
import { ArrowLeft, ChevronRight } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { cn } from '@/lib/utils';
import { SURFACE } from '@/lib/surfaces';
import { Skeleton } from '@/components/ui/skeleton';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';
import { DatePicker } from '@/components/smm/shared/DatePicker';
import { SyncStatus } from '@/components/buddyx/SyncStatus';
import { KpiTile, LegendSwatch, LoadError, SEGMENT } from '@/components/buddyx/buddyxUi';
import { FlagList, integrityBasis } from '@/components/buddyx/integrityUi';
import { ShiftTimeline } from '@/components/buddyx/ShiftTimeline';
import { CHATTER_PERIOD_OPTIONS, chatterAnalyticsUrl, chatterReportHref } from '@/components/buddyx/chatterPeriods';
import { useBuddyxAnalytics } from '@/hooks/useBuddyxAnalytics';
import { useViewerTimezone } from '@/hooks/useViewerTimezone';
import { formatUsd } from '@/lib/salary/salaryFormat';
import { formatDayLabelWithWeekday } from '@/lib/salary/salaryDate';
import { formatCount, formatDuration, formatShare } from '@/lib/buddyx/analyticsFormat';
import { SEQUENTIAL_COLOR } from '@/lib/buddyx/chartColors';
import { STATUS_HEX } from '@/lib/campaignTracking';
import { COVERAGE_FLAG_RATIO, HOUR_MS } from '@/lib/buddyx/coverage';
import { CHATTER_PERIODS, MAX_CUSTOM_DAYS, type ChatterPeriod, type ChatterReport, type ReportShift } from '@/lib/buddyx/analyticsTypes';

/**
 * One chat agent's report — `/ca-portal/chatter-analytics/[uid]`, `ca-admin`
 * only (the API refuses anyone else; the page inherits Chatter Analytics'
 * permission by path).
 *
 * Reads top to bottom as the question an admin brings to it: how much of the
 * clocked time was real (coverage), what was flagged and when, how that moved
 * day to day, and then every shift — each opening to its minute-level
 * timeline, which is the evidence behind every number above it. Display only:
 * nothing here changes worked time or pay.
 */

/**
 * The client half of the report. `uid` arrives as a prop from the server page
 * (`page.tsx`), never from `useParams()`: under Cache Components this route is
 * partially prerendered, and a client component in the prerendered shell reads
 * the dynamic-param *placeholder* (`%%drp:uid:…%%`), which went to the API as
 * the agent id and produced an empty report for everyone.
 */
export function ReportView({ uid }: { uid: string }) {
  const search = useSearchParams();
  const router = useRouter();
  const initialPeriod = search.get('period');
  const [period, setPeriod] = useState<ChatterPeriod>(
    CHATTER_PERIODS.includes(initialPeriod as ChatterPeriod) ? (initialPeriod as ChatterPeriod) : '7d',
  );
  const [from, setFrom] = useState<Date | undefined>(() => (search.get('from') ? new Date(`${search.get('from')}T12:00:00`) : undefined));
  const [to, setTo] = useState<Date | undefined>(() => (search.get('to') ? new Date(`${search.get('to')}T12:00:00`) : undefined));
  const range = useMemo(
    () => ({ from: from ? format(from, 'yyyy-MM-dd') : null, to: to ? format(to, 'yyyy-MM-dd') : null }),
    [from, to],
  );
  const url = useMemo(
    () => chatterAnalyticsUrl(`/api/analytics/chatters/${encodeURIComponent(uid)}`, period, range.from, range.to),
    [uid, period, range],
  );
  const { data, loading, error, reload } = useBuddyxAnalytics<ChatterReport>(url);

  const choosePeriod = (next: ChatterPeriod) => {
    setPeriod(next);
    // Keep the address shareable: the report someone links is the one they saw.
    if (next !== 'custom') router.replace(chatterReportHref(uid, next, null, null), { scroll: false });
  };

  const backHref = chatterAnalyticsUrl('/ca-portal/chatter-analytics', period, range.from, range.to) ?? '/ca-portal/chatter-analytics';

  return (
    <div className="max-w-7xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link
            href={backHref}
            prefetch={false}
            className="inline-flex items-center gap-1 rounded-sm text-xs text-zinc-400 hover:text-white focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <ArrowLeft className="size-3.5" aria-hidden /> Chatter Analytics
          </Link>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">{data?.name ?? (loading ? ' ' : 'Agent report')}</h1>
          <p className="mt-1 text-sm text-zinc-400">
            BuddyX activity against Bluu time tracking, shift by shift. Display only — nothing here changes pay.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <ToggleGroup type="single" variant="outline" size="sm" value={period} onValueChange={v => v && choosePeriod(v as ChatterPeriod)} aria-label="Period">
            {CHATTER_PERIOD_OPTIONS.map(p => <ToggleGroupItem key={p.value} value={p.value} className={SEGMENT}>{p.label}</ToggleGroupItem>)}
          </ToggleGroup>
          <SyncStatus scope="chatters" onSynced={() => void reload(true)} />
        </div>
      </div>

      {period === 'custom' && (
        <div className="flex flex-wrap items-center gap-2">
          <DatePicker value={from} onChange={setFrom} placeholder="From" className="h-8 w-44 text-sm" />
          <DatePicker value={to} onChange={setTo} placeholder="To" className="h-8 w-44 text-sm" />
          <p className="text-[11px] text-zinc-400">Up to {MAX_CUSTOM_DAYS} days.</p>
        </div>
      )}

      {!url ? (
        <p className="text-sm text-zinc-400">Pick a start and an end day.</p>
      ) : loading && !data ? (
        <ReportSkeleton />
      ) : error && !data ? (
        <LoadError error={error} onRetry={() => void reload(true)} />
      ) : data ? (
        <ReportBody report={data} />
      ) : null}
    </div>
  );
}

export function ReportSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        {[0, 1, 2, 3, 4].map(i => <Skeleton key={i} className="h-[92px] rounded-xl" />)}
      </div>
      <Skeleton className="h-12 rounded-xl" />
      <Skeleton className="h-56 rounded-xl" />
      <Skeleton className="h-72 rounded-xl" />
    </div>
  );
}

const dayConfig = {
  clockedHours: { label: 'Clocked working', color: STATUS_HEX.zinc },
  onlineHours: { label: 'Online while clocked', color: SEQUENTIAL_COLOR },
} satisfies ChartConfig;

function ReportBody({ report }: { report: ChatterReport }) {
  const { coverage, integrity, metrics } = report;
  const flaggedMinutes = integrity ? integrity.regularMinutes + integrity.modifierOnlyMinutes + integrity.staticMinutes : null;
  const days = report.daily.map(d => ({
    day: d.day,
    clockedHours: Math.round((d.clockedMs / HOUR_MS) * 10) / 10,
    onlineHours: Math.round((d.onlineWhileClockedMs / HOUR_MS) * 10) / 10,
  }));
  const anyDay = days.some(d => d.clockedHours > 0 || d.onlineHours > 0);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <KpiTile
          label="Coverage"
          value={formatShare(coverage?.ratio)}
          meta={coverage ? `${formatDuration(coverage.onlineWhileClockedMs)} online of ${formatDuration(coverage.clockedMs)} clocked` : 'No clocked time'}
        />
        <KpiTile
          label="Clocked working"
          value={formatDuration(coverage?.clockedMs ?? null)}
          meta={coverage ? `${formatDuration(coverage.onlineMs)} online in BuddyX in total` : undefined}
        />
        <KpiTile
          label="Revenue"
          basis="gross"
          value={formatUsd((metrics?.ppvGross ?? 0) + (metrics?.tipsGross ?? 0))}
          meta={metrics ? `${formatUsd(metrics.ppvGross)} PPV · ${formatUsd(metrics.tipsGross)} tips` : undefined}
        />
        <KpiTile label="Messages" value={formatCount(metrics?.totalMessages ?? null)} meta={metrics?.fansChatted != null ? `${formatCount(metrics.fansChatted)} fans chatted` : undefined} />
        <KpiTile
          label="Flagged time"
          value={flaggedMinutes === null ? '—' : formatDuration(flaggedMinutes * 60_000)}
          meta={integrityBasis(integrity)}
        />
      </div>

      <MonitoringLine report={report} />

      <section aria-labelledby="report-flags" className="space-y-2">
        <h2 id="report-flags" className="text-sm font-semibold">What needs a look</h2>
        <FlagList flags={report.flags} withNames={false} cleanLine="Nothing flagged this period." />
      </section>

      {anyDay && (
        <section className={cn('rounded-xl p-5', SURFACE)} aria-labelledby="by-day">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="by-day" className="text-sm font-semibold">Clocked vs online, by day</h2>
            <div className="flex items-center gap-3 text-xs text-zinc-300">
              <span className="inline-flex items-center gap-1.5"><LegendSwatch color={dayConfig.clockedHours.color} /> Clocked working</span>
              <span className="inline-flex items-center gap-1.5"><LegendSwatch color={SEQUENTIAL_COLOR} /> Online while clocked</span>
            </div>
          </div>
          <ChartContainer config={dayConfig} className="mt-3 h-[200px] w-full">
            <BarChart data={days} margin={{ left: 4, right: 8, top: 8 }} barGap={2}>
              <CartesianGrid vertical={false} strokeOpacity={0.15} />
              <XAxis dataKey="day" tickLine={false} axisLine={false} tickMargin={8} minTickGap={12} tickFormatter={d => formatDayLabelWithWeekday(String(d)).split(' ').slice(0, 2).join(' ')} />
              <YAxis tickLine={false} axisLine={false} width={36} tickFormatter={v => `${v}h`} />
              <ChartTooltip content={<ChartTooltipContent labelFormatter={l => formatDayLabelWithWeekday(String(l))} formatter={(v, n) => [` ${v}h`, n === 'clockedHours' ? 'Clocked working' : 'Online while clocked']} />} />
              <Bar dataKey="clockedHours" fill="var(--color-clockedHours)" radius={[3, 3, 0, 0]} />
              <Bar dataKey="onlineHours" fill="var(--color-onlineHours)" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ChartContainer>
        </section>
      )}

      <ShiftTable report={report} />
    </div>
  );
}

/** Whether the integrity numbers above can be trusted to be complete, said once, plainly. */
function MonitoringLine({ report }: { report: ChatterReport }) {
  const i = report.integrity;
  let text: string | null = null;
  if (!report.inputMonitoring && !i) {
    text = `Input monitoring is off for ${report.name}, so typing rhythm and unchanged screens are not checked. Turn it on in Shift Management → Organization Settings.`;
  } else if (!report.inputMonitoring) {
    text = `Input monitoring is off for ${report.name} now; the figures below are from when it was on.`;
  } else if (i?.inputSource === 'counters' && i.permission === 'denied') {
    text = `${report.name} has not allowed Input Monitoring on their Mac, so typing is read from coarse system counters — a Shift jiggler still shows, a filler key does not.`;
  } else if (!i) {
    text = 'Input monitoring is on, but no monitored screenshot has landed in this period yet. It needs app v0.17.0 and screenshots on.';
  }
  return text ? <p className="text-sm text-zinc-400">{text}</p> : null;
}

function ShiftTable({ report }: { report: ChatterReport }) {
  const { timezone } = useViewerTimezone();
  const [open, setOpen] = useState<number | null>(null);
  const day = useMemo(() => new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: timezone }), [timezone]);
  const clock = useMemo(() => new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: timezone }), [timezone]);

  if (report.shifts.length === 0) {
    return <p className="text-sm text-zinc-400">No shifts or clocked sessions in this period.</p>;
  }

  return (
    <section className={cn('rounded-xl p-5', SURFACE)} aria-labelledby="shifts">
      <h2 id="shifts" className="text-sm font-semibold">Shifts</h2>
      <p className="mt-0.5 text-[11px] text-zinc-400">
        Newest first, with any session worked off-roster. Open a shift for its minute-by-minute timeline. Messages count whole hours, so a shift starting mid-hour reads slightly high.
      </p>
      <div tabIndex={0} role="region" aria-label="Shifts, scrollable" className="mt-3 overflow-x-auto rounded-lg border border-white/[0.07] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/50">
        <table className="w-full min-w-[860px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-white/[0.07] text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
              <th scope="col" className="px-3 py-2.5 text-left">Shift</th>
              <th scope="col" className="px-3 py-2.5 text-right">Clocked</th>
              <th scope="col" className="px-3 py-2.5 text-right">Online while clocked</th>
              <th scope="col" className="px-3 py-2.5 text-right">Coverage</th>
              <th scope="col" className="px-3 py-2.5 text-right">Messages</th>
              <th scope="col" className="px-3 py-2.5 text-right">Flagged</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.045]">
            {report.shifts.map((s, i) => (
              <Fragment key={`${s.startMs}-${i}`}>
                {/* The whole row toggles; the button is the keyboard route. */}
                <tr
                  onClick={() => setOpen(open === i ? null : i)}
                  className={cn('cursor-pointer hover:bg-white/[0.055] active:bg-white/[0.08]', open === i && 'bg-white/[0.055]')}
                >
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      aria-expanded={open === i}
                      onClick={e => {
                        e.stopPropagation();
                        setOpen(open === i ? null : i);
                      }}
                      className="inline-flex items-center gap-2 rounded-sm text-left focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    >
                      <ChevronRight className={cn('size-3.5 text-zinc-400 transition-transform', open === i && 'rotate-90')} aria-hidden />
                      <span>
                        <span className="tabular-nums">{day.format(s.startMs)} · {clock.format(s.startMs)}–{clock.format(s.endMs)}</span>
                        <span className="block text-[11px] text-zinc-400">{shiftKind(s)}</span>
                      </span>
                    </button>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{formatDuration(s.clockedMs)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{s.onlineWhileClockedMs === null ? <Pending /> : formatDuration(s.onlineWhileClockedMs)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                    {s.ratio === null ? <span className="text-zinc-400">—</span> : <span className={s.ratio < COVERAGE_FLAG_RATIO ? 'text-orange-400' : undefined}>{formatShare(s.ratio)}</span>}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{s.messages === null ? <Pending /> : formatCount(s.messages)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{flaggedCell(s)}</td>
                </tr>
                {open === i && (
                  <tr>
                    <td colSpan={6} className="px-3 pt-2 pb-4">
                      <ShiftTimeline uid={report.uid} startMs={s.startMs} endMs={s.endMs} scheduled={s.scheduled} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Pending() {
  return <span className="text-zinc-400" title="Hourly BuddyX data for this shift has not synced yet">—</span>;
}

function shiftKind(s: ReportShift): string {
  if (!s.scheduled) return 'Unscheduled session';
  const parts = [s.isOvertime ? 'Overtime shift' : 'Scheduled shift'];
  if (s.accounts > 0) parts.push(`${s.accounts} ${s.accounts === 1 ? 'account' : 'accounts'}`);
  return parts.join(' · ');
}

function flaggedCell(s: ReportShift) {
  const parts: string[] = [];
  if (s.regularMinutes > 0) parts.push(`${s.regularMinutes}m regular`);
  if (s.modifierOnlyMinutes > 0) parts.push(`${s.modifierOnlyMinutes}m modifier`);
  if (s.staticMinutes > 0) parts.push(`${s.staticMinutes}m static`);
  if (parts.length === 0) return <span className="text-zinc-400">{s.monitored ? 'None' : '—'}</span>;
  return <span className="text-orange-400">{parts.join(' · ')}</span>;
}
