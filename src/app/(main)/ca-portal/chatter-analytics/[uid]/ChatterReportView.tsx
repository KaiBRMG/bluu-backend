'use client';

import { Fragment, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { format } from 'date-fns';
import { ArrowLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SURFACE } from '@/lib/surfaces';
import { Skeleton } from '@/components/ui/skeleton';
import { PeriodPicker, dayKeyToDate } from '@/components/buddyx/PeriodPicker';
import { SyncStatus } from '@/components/buddyx/SyncStatus';
import { BasisTag, KpiTile, LegendSwatch, LoadError } from '@/components/buddyx/buddyxUi';
import { FlagList, integrityBasis } from '@/components/buddyx/integrityUi';
import { ShiftTimeline } from '@/components/buddyx/ShiftTimeline';
import { DailySalesChart } from '@/components/buddyx/SalesBoard';
import { chatterPeriodOptions, chatterAnalyticsUrl, chatterReportHref } from '@/components/buddyx/chatterPeriods';
import { useBuddyxAnalytics } from '@/hooks/useBuddyxAnalytics';
import { useViewerTimezone } from '@/hooks/useViewerTimezone';
import { formatUsd } from '@/lib/salary/salaryFormat';
import { formatCount, formatDuration } from '@/lib/buddyx/analyticsFormat';
import { SALE_KIND_COLORS, SEQUENTIAL_COLOR } from '@/lib/buddyx/chartColors';
import { CHATTER_PERIODS, type ChatterPeriod, type ChatterReport, type ReportAccount, type ReportShift } from '@/lib/buddyx/analyticsTypes';

/**
 * One chat agent's report — `/ca-portal/chatter-analytics/[uid]`, `ca-admin`
 * only (the API refuses anyone else; the page inherits Chatter Analytics'
 * permission by path).
 *
 * Reads top to bottom as the question an admin brings to it: what did this
 * agent sell and where do they stand, which accounts and which days it came
 * from, what was flagged, and then every shift with the sales made in it —
 * each opening to its minute-level timeline. Display only: nothing here
 * changes worked time or pay.
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
  // A preset's days are resolved on the server (salary timezone); show the ones it answered with.
  const presetData = period !== 'custom' && data?.period === period ? data : null;

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
            Sales by day, by account and by shift, then the shift-by-shift evidence. Display only — nothing here changes pay.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <PeriodPicker
            options={chatterPeriodOptions()}
            value={period}
            onPresetChange={choosePeriod}
            from={period === 'custom' ? from : dayKeyToDate(presetData?.from)}
            to={period === 'custom' ? to : dayKeyToDate(presetData?.to)}
            onRangeChange={(nextFrom, nextTo) => {
              setPeriod('custom');
              setFrom(nextFrom);
              setTo(nextTo);
            }}
          />
          <SyncStatus scope="chatters" onSynced={() => void reload(true)} />
        </div>
      </div>

      {!url ? (
        <p className="text-sm text-zinc-400">{from && to ? 'The end date must be on or after the start date.' : 'Pick a start and an end date.'}</p>
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

function ReportBody({ report }: { report: ChatterReport }) {
  const { integrity, metrics } = report;
  const flaggedMinutes = integrity ? integrity.regularMinutes + integrity.modifierOnlyMinutes + integrity.staticMinutes : null;
  const gross = (metrics?.ppvGross ?? 0) + (metrics?.tipsGross ?? 0);
  const hours = report.clockedMs / 3_600_000;
  const anySales = report.daily.some(d => d.ppvGross !== 0 || d.tipsGross !== 0);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <KpiTile
          label="Sales"
          basis="gross"
          value={formatUsd(gross)}
          meta={metrics ? `${formatUsd(metrics.ppvGross)} PPV · ${formatUsd(metrics.tipsGross)} tips` : 'No sales'}
        />
        <KpiTile label="Place on the board" value={report.rank ? `#${report.rank.position}` : '—'} meta={report.rank ? `of ${report.rank.of} agents` : undefined} />
        <KpiTile
          label="Per clocked hour"
          basis="gross"
          value={hours >= 1 ? formatUsd(gross / hours) : '—'}
          meta={`${formatDuration(report.clockedMs)} clocked`}
        />
        <KpiTile label="Messages" value={formatCount(metrics?.totalMessages ?? null)} meta={metrics?.fansChatted != null ? `${formatCount(metrics.fansChatted)} fans chatted` : undefined} />
        <KpiTile
          label="Flagged time"
          value={flaggedMinutes === null ? '—' : formatDuration(flaggedMinutes * 60_000)}
          meta={integrityBasis(integrity)}
        />
      </div>

      {anySales && (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
          <section className={cn('min-w-0 rounded-xl p-5', SURFACE)} aria-labelledby="by-day">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 id="by-day" className="text-sm font-semibold">Sales by day</h2>
              <div className="flex items-center gap-3 text-xs text-zinc-300">
                <span className="inline-flex items-center gap-1.5"><LegendSwatch color={SALE_KIND_COLORS.ppv} /> PPV</span>
                <span className="inline-flex items-center gap-1.5"><LegendSwatch color={SALE_KIND_COLORS.tip} /> Tips</span>
              </div>
            </div>
            <DailySalesChart daily={report.daily} className="mt-3" />
          </section>
          <AccountList accounts={report.accounts} />
        </div>
      )}

      <MonitoringLine report={report} />

      <section aria-labelledby="report-flags" className="space-y-2">
        <h2 id="report-flags" className="text-sm font-semibold">What needs a look</h2>
        <FlagList flags={report.flags} withNames={false} cleanLine="Nothing flagged this period." />
      </section>

      <ShiftTable report={report} />
    </div>
  );
}

/** Where the agent's money came from: one bar per account on a shared scale, largest first. */
function AccountList({ accounts }: { accounts: ReportAccount[] }) {
  const scale = Math.max(0, ...accounts.map(a => a.gross));
  return (
    <section className={cn('min-w-0 rounded-xl p-5', SURFACE)} aria-labelledby="by-account">
      <h2 id="by-account" className="flex items-center gap-1.5 text-sm font-semibold">
        By account <BasisTag basis="gross" />
      </h2>
      <ul className="mt-3 space-y-3">
        {accounts.map(a => (
          <li key={a.key}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="truncate">{a.name}</span>
              <span className="shrink-0 font-semibold tabular-nums">{formatUsd(a.gross)}</span>
            </div>
            <div className="mt-1 flex items-center gap-3">
              <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.06]" aria-hidden>
                <span
                  className="block h-full rounded-full"
                  style={{ width: scale > 0 ? `${(Math.max(a.gross, 0) / scale) * 100}%` : '0%', background: SEQUENTIAL_COLOR }}
                />
              </span>
              <span className="w-16 shrink-0 text-right text-[11px] tabular-nums text-zinc-400">
                {formatCount(a.sales)} {a.sales === 1 ? 'sale' : 'sales'}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </section>
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
        Newest first, with any session worked off-roster. Sales are those made inside the shift&apos;s window. Open a shift for its minute-by-minute timeline. Messages count whole hours, so a shift starting mid-hour reads slightly high.
      </p>
      <div tabIndex={0} role="region" aria-label="Shifts, scrollable" className="mt-3 overflow-x-auto rounded-lg border border-white/[0.07] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/50">
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-white/[0.07] text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
              <th scope="col" className="px-3 py-2.5 text-left">Shift</th>
              <th scope="col" className="px-3 py-2.5 text-right">Clocked</th>
              <th scope="col" className="px-3 py-2.5 text-right">Sales (gross)</th>
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
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                    {s.salesCount === 0 ? (
                      <span className="text-zinc-400">None</span>
                    ) : (
                      <>
                        {formatUsd(s.gross)}
                        <span className="block text-[11px] text-zinc-400">
                          {s.salesCount} {s.salesCount === 1 ? 'sale' : 'sales'}
                        </span>
                      </>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{s.messages === null ? <Pending /> : formatCount(s.messages)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{flaggedCell(s)}</td>
                </tr>
                {open === i && (
                  <tr>
                    <td colSpan={5} className="px-3 pt-2 pb-4">
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
