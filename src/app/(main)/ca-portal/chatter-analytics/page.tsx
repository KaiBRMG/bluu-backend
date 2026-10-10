'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { format } from 'date-fns';
import { ArrowDown, ArrowUp, Loader2Icon } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { toast } from 'sonner';
import AppLayout from '@/components/AppLayout';
import { cn } from '@/lib/utils';
import { SURFACE } from '@/lib/surfaces';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';
import { DatePicker } from '@/components/smm/shared/DatePicker';
import { SyncStatus } from '@/components/buddyx/SyncStatus';
import { BenchmarkStrip } from '@/components/buddyx/BenchmarkStrip';
import { LegendSwatch, PPV_ATTRIBUTION, TIPS_ATTRIBUTION, KpiTile, Fact, LoadError, SEGMENT } from '@/components/buddyx/buddyxUi';
import { PersonTag } from '@/components/disputes/disputeUi';
import { CoverageMeter, CoverageScatter, FlagChips, FlagList } from '@/components/buddyx/integrityUi';
import { COVERAGE_FLAG_RATIO } from '@/lib/buddyx/coverage';
import { CHATTER_PERIOD_OPTIONS, chatterAnalyticsUrl, chatterReportHref } from '@/components/buddyx/chatterPeriods';
import { useAuthFetch } from '@/hooks/useAuthFetch';
import { useBuddyxAnalytics } from '@/hooks/useBuddyxAnalytics';
import { formatUsd } from '@/lib/salary/salaryFormat';
import { formatDayLabelWithWeekday } from '@/lib/salary/salaryDate';
import { formatCount, formatDuration, formatRate, formatShare } from '@/lib/buddyx/analyticsFormat';
import { SALE_KIND_COLORS } from '@/lib/buddyx/chartColors';
import { MAX_CUSTOM_DAYS, type BenchmarkKey, type ChatterAnalytics, type ChatterLeaderboardRow, type ChatterPeriod, type IntegrityFlag } from '@/lib/buddyx/analyticsTypes';

/**
 * Chatter Analytics — `/ca-portal/chatter-analytics`.
 *
 * An agent asks "how am I doing against the team?"; an admin asks "was
 * everyone actually working while they were clocked in?" — so the admin view
 * leads with what needs a look (the flag list), then everyone's coverage in one
 * picture, then the named table, each row opening that agent's report
 * (`./[uid]`). The default period is the last 7 complete days.
 *
 * The agent's comparison is anonymous by construction — the server sends a
 * median and a quartile, never a colleague (D8). Integrity flags are admin
 * only; an agent sees their own coverage figure and nothing else of it.
 * Display only: nothing on this page changes worked time or pay.
 */

const BENCHMARK_LABELS: Record<BenchmarkKey, { label: string; format: (v: number) => string }> = {
  ppvGross: { label: 'PPV revenue (gross)', format: v => formatUsd(v) },
  tipsGross: { label: 'Tips (gross)', format: v => formatUsd(v) },
  unlockRate: { label: 'Unlock rate', format: v => formatRate(v, 1) },
  medianResponseTimeMs: { label: 'Reply time', format: v => formatDuration(v) },
  fansChatted: { label: 'Fans chatted', format: v => formatCount(v) },
  totalMessages: { label: 'Messages', format: v => formatCount(v) },
  onlineMs: { label: 'Online time', format: v => formatDuration(v) },
  revenuePerOnlineHour: { label: 'Gross / online hour', format: v => formatUsd(v) },
};

const dailyConfig = {
  tipsGross: { label: 'Tips', color: SALE_KIND_COLORS.tip },
  ppvGross: { label: 'PPV', color: SALE_KIND_COLORS.ppv },
} satisfies ChartConfig;

export default function ChatterAnalyticsPage() {
  const [period, setPeriod] = useState<ChatterPeriod>('7d');
  const [from, setFrom] = useState<Date | undefined>(undefined);
  const [to, setTo] = useState<Date | undefined>(undefined);

  const range = useMemo(
    () => ({ from: from ? format(from, 'yyyy-MM-dd') : null, to: to ? format(to, 'yyyy-MM-dd') : null }),
    [from, to],
  );
  const url = useMemo(() => chatterAnalyticsUrl('/api/analytics/chatters', period, range.from, range.to), [period, range]);
  const { data, loading, error, reload } = useBuddyxAnalytics<ChatterAnalytics>(url);

  return (
    <AppLayout>
      <div className="max-w-7xl space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Chatter Analytics</h1>
            <p className="mt-1 text-sm text-zinc-400">
              {data?.leaderboard
                ? 'Every chat agent — BuddyX activity against Bluu time tracking.'
                : 'How you are doing against the team, from BuddyX.'}{' '}
              Money is gross — what fans paid; net is 80% after OnlyFans&apos; 20%.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <ToggleGroup type="single" variant="outline" size="sm" value={period} onValueChange={v => v && setPeriod(v as ChatterPeriod)} aria-label="Period">
              {CHATTER_PERIOD_OPTIONS.map(p => <ToggleGroupItem key={p.value} value={p.value} className={SEGMENT}>{p.label}</ToggleGroupItem>)}
            </ToggleGroup>
            <SyncStatus scope="chatters" onSynced={() => void reload(true)} />
          </div>
        </div>

        {period === 'custom' && (
          <div className="flex flex-wrap items-center gap-2">
            <DatePicker value={from} onChange={setFrom} placeholder="From" className="h-8 w-44 text-sm" />
            <DatePicker value={to} onChange={setTo} placeholder="To" className="h-8 w-44 text-sm" />
            <p className="text-[11px] text-zinc-400">Up to {MAX_CUSTOM_DAYS} days, as far back as October 2025. Totals are summed from days.</p>
          </div>
        )}

        {!url ? (
          <p className="text-sm text-zinc-400">Pick a start and an end day.</p>
        ) : loading && !data ? (
          <PageSkeleton />
        ) : error && !data ? (
          <LoadError error={error} onRetry={() => void reload(true)} />
        ) : data ? (
          <ChatterBody data={data} range={range} onPulled={() => void reload(true)} />
        ) : null}
      </div>
    </AppLayout>
  );
}

function PageSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        {[0, 1, 2, 3, 4].map(i => <Skeleton key={i} className="h-[92px] rounded-xl" />)}
      </div>
      <Skeleton className="h-64 rounded-xl" />
      <Skeleton className="h-56 rounded-xl" />
    </div>
  );
}


function ChatterBody({
  data,
  range,
  onPulled,
}: {
  data: ChatterAnalytics;
  range: { from: string | null; to: string | null };
  onPulled: () => void;
}) {
  const me = data.me;
  const isAdmin = data.leaderboard !== null;

  return (
    <div className="space-y-6">
      {isAdmin && <AdminView data={data} range={range} />}

      {isAdmin && me && (
        <div className="border-t border-white/[0.07] pt-6">
          <h2 className="text-sm font-semibold">Your own figures</h2>
          <p className="mt-0.5 text-[11px] text-zinc-400">You chat too, so here is your own row as an agent sees it.</p>
        </div>
      )}

      {/* ── KPI row ── */}
      {me ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
          <KpiTile label="PPV revenue" basis="gross" tip={PPV_ATTRIBUTION} value={formatUsd(me.ppvGross)} meta={`${formatCount(me.ppvSales)} sold`} />
          <KpiTile label="Tips" basis="gross" tip={TIPS_ATTRIBUTION} value={formatUsd(me.tipsGross)} meta={`${formatCount(me.tipsCount)} tips`} />
          <KpiTile label="Unlock rate" value={formatRate(me.unlockRate, 1)} meta={`${formatCount(me.ppvsSent)} PPVs sent`} />
          <KpiTile label="Median reply time" value={formatDuration(me.medianResponseTimeMs)} meta={me.p75ResponseTimeMs !== null ? `3 in 4 within ${formatDuration(me.p75ResponseTimeMs)}` : undefined} />
          <KpiTile label="Online time" value={formatDuration(me.onlineMs)} meta={me.revenuePerOnlineHour !== null ? `${formatUsd(me.revenuePerOnlineHour)} gross per online hour` : undefined} />
        </div>
      ) : (
        !isAdmin && (
          <p className="text-sm text-zinc-400">
            No sales or BuddyX activity for you in this period. If you worked in BuddyX, ask an admin to check your account is linked.
          </p>
        )
      )}

      {data.from < data.activityFrom && (
        <p className="text-sm text-zinc-400">
          Revenue covers the whole period — Infloww history before 4 Oct 2026, BuddyX after. Messages, fans chatted,
          unlock rate, online and reply times only exist from BuddyX, which starts{' '}
          {formatDayLabelWithWeekday(data.activityFrom)}; {data.to < data.activityFrom ? 'this period has none' : 'they cover only the days from then'}.
        </p>
      )}

      {!data.hasMedians && data.to >= data.activityFrom && (
        <CustomMedianNote data={data} isAdmin={isAdmin} onPulled={onPulled} />
      )}

      {/* ── Online while clocked in (the agent's own coverage; never flags) ── */}
      {!isAdmin && data.coverage && (
        <section className={cn('rounded-xl p-5', SURFACE)} aria-labelledby="my-coverage">
          <h2 id="my-coverage" className="text-sm font-semibold">Online while clocked in</h2>
          <p className="mt-0.5 text-[11px] text-zinc-400">
            Your BuddyX online time that fell inside your clocked working time. Breaks don&apos;t count against you.
          </p>
          <div className="mt-3">
            <CoverageMeter coverage={data.coverage} />
          </div>
        </section>
      )}

      {/* ── You vs team ── */}
      {me && (
        <section className={cn('rounded-xl p-5', SURFACE)} aria-labelledby="vs-team">
          <h2 id="vs-team" className="text-sm font-semibold">You vs the team</h2>
          <p className="mt-0.5 text-[11px] text-zinc-400">
            The light tick is the top quartile, the grey tick the team median, the blue dot you. Further right is better.
          </p>
          {data.benchmarks ? (
            <div className="mt-2 divide-y divide-white/[0.07]">
              {data.benchmarks.filter(b => b.median !== null).map(b => (
                <BenchmarkStrip key={b.key} label={BENCHMARK_LABELS[b.key].label} benchmark={b} format={BENCHMARK_LABELS[b.key].format} />
              ))}
            </div>
          ) : (
            <p className="mt-3 text-sm text-zinc-400">Not enough agents active this period to compare.</p>
          )}
        </section>
      )}

      {/* ── Daily trend ── */}
      {me && data.daily.length > 0 && (
        <section className={cn('rounded-xl p-5', SURFACE)} aria-labelledby="daily-trend">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="daily-trend" className="text-sm font-semibold">Your gross revenue by day</h2>
            <div className="flex items-center gap-3 text-xs text-zinc-300">
              <span className="inline-flex items-center gap-1.5"><LegendSwatch color={SALE_KIND_COLORS.tip} /> Tips</span>
              <span className="inline-flex items-center gap-1.5"><LegendSwatch color={SALE_KIND_COLORS.ppv} /> PPV</span>
            </div>
          </div>
          <ChartContainer config={dailyConfig} className="mt-3 h-[200px] w-full">
            <BarChart data={data.daily} margin={{ left: 4, right: 8, top: 8 }}>
              <CartesianGrid vertical={false} strokeOpacity={0.15} />
              <XAxis dataKey="day" tickLine={false} axisLine={false} tickMargin={8} minTickGap={12} tickFormatter={d => String(d).slice(8)} />
              <YAxis tickLine={false} axisLine={false} width={48} tickFormatter={v => `$${v}`} />
              <ChartTooltip content={<ChartTooltipContent labelFormatter={l => formatDayLabelWithWeekday(String(l))} formatter={(v, n) => [` ${formatUsd(Number(v))}`, n === 'tipsGross' ? 'Tips' : 'PPV']} />} />
              <Bar dataKey="tipsGross" stackId="k" fill="var(--color-tipsGross)" stroke="var(--card)" strokeWidth={2} />
              <Bar dataKey="ppvGross" stackId="k" fill="var(--color-ppvGross)" stroke="var(--card)" strokeWidth={2} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ChartContainer>
        </section>
      )}

      {/* ── Messaging ── */}
      {me && (
        <section className={cn('rounded-xl p-5', SURFACE)} aria-labelledby="messaging">
          <h2 id="messaging" className="text-sm font-semibold">Messaging</h2>
          <dl className="mt-3 grid grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-4">
            <Fact label="Fans chatted" value={formatCount(me.fansChatted)} />
            <Fact label="Messages" value={formatCount(me.totalMessages)} />
            <Fact label="PPVs sent → unlocked" value={`${formatCount(me.ppvsSent)} → ${formatCount(me.ppvsUnlocked)}`} meta={formatRate(me.unlockRate, 1)} />
            <Fact
              label="Mass messages"
              value={formatCount(data.mass.count)}
              meta={`${data.mass.avgPrice !== null ? `avg list price ${formatUsd(data.mass.avgPrice)}` : 'all free'} · ${data.mass.unsent} unsent`}
            />
          </dl>
        </section>
      )}

    </div>
  );
}


function CustomMedianNote({ data, isAdmin, onPulled }: { data: ChatterAnalytics; isAdmin: boolean; onPulled: () => void }) {
  const authFetch = useAuthFetch();
  const [busy, setBusy] = useState(false);
  if (data.period !== 'custom') return null;
  return (
    <p className="flex flex-wrap items-center gap-2 text-sm text-zinc-400">
      Medians need a fresh pull for custom ranges — reply times show “—” until then.
      {isAdmin && (
        <Button
          size="xs"
          variant="outline"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await authFetch('/api/analytics/chatters/pull', { method: 'POST', body: JSON.stringify({ from: data.from, to: data.to }) });
              toast.success('Pulled the whole range from BuddyX');
              onPulled();
            } catch (err) {
              toast.error(err instanceof Error ? err.message : 'Pull failed');
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy && <Loader2Icon className="activity-spinner size-3 animate-spin" aria-hidden />}
          Pull
        </Button>
      )}
    </p>
  );
}

// ─── Admin ───────────────────────────────────────────────────────────

type SortKey =
  | 'coverage'
  | 'revenue'
  | 'ppvGross'
  | 'tipsGross'
  | 'unlockRate'
  | 'medianResponseTimeMs'
  | 'onlineMs'
  | 'revenuePerOnlineHour'
  | 'revenuePerAccount';

const COLUMNS: Array<{ key: Exclude<SortKey, 'coverage'>; label: string; render: (r: ChatterLeaderboardRow) => string }> = [
  { key: 'revenue', label: 'Gross', render: r => formatUsd(r.ppvGross + r.tipsGross) },
  { key: 'ppvGross', label: 'PPV gross', render: r => formatUsd(r.ppvGross) },
  { key: 'tipsGross', label: 'Tips gross', render: r => formatUsd(r.tipsGross) },
  { key: 'unlockRate', label: 'Unlock', render: r => formatRate(r.unlockRate, 1) },
  { key: 'medianResponseTimeMs', label: 'Reply', render: r => formatDuration(r.medianResponseTimeMs) },
  { key: 'onlineMs', label: 'Online', render: r => formatDuration(r.onlineMs) },
  { key: 'revenuePerOnlineHour', label: 'Gross / online h', render: r => (r.revenuePerOnlineHour === null ? '—' : formatUsd(r.revenuePerOnlineHour)) },
  { key: 'revenuePerAccount', label: 'Gross / account', render: r => (r.revenuePerAccount === null ? '—' : formatUsd(r.revenuePerAccount)) },
];

/** Lower-is-worse ascending by default: coverage and reply time sort worst-first. */
const ASCENDING_FIRST: ReadonlySet<SortKey> = new Set(['coverage', 'medianResponseTimeMs']);

function sortValue(r: ChatterLeaderboardRow, key: SortKey): number {
  if (key === 'revenue') return r.ppvGross + r.tipsGross;
  if (key === 'coverage') return r.coverage?.ratio ?? Infinity;
  const v = r[key];
  return typeof v === 'number' ? v : -Infinity;
}

const HEAD = 'text-[11px] font-semibold uppercase tracking-wide text-zinc-400';

function AdminView({ data, range }: { data: ChatterAnalytics; range: { from: string | null; to: string | null } }) {
  const router = useRouter();
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'coverage', desc: false });
  const flags = useMemo(() => data.flags ?? [], [data.flags]);
  const flagsByUid = useMemo(() => {
    const map = new Map<string, IntegrityFlag[]>();
    for (const f of flags) map.set(f.uid, [...(map.get(f.uid) ?? []), f]);
    return map;
  }, [flags]);
  const rows = useMemo(() => {
    const list = [...(data.leaderboard ?? [])];
    list.sort((a, b) => {
      const d = sortValue(a, sort.key) - sortValue(b, sort.key);
      return sort.desc ? -d : d;
    });
    return list;
  }, [data.leaderboard, sort]);
  const hrefFor = (uid: string) => chatterReportHref(uid, data.period, range.from, range.to);
  const agents = (data.leaderboard ?? []).filter(r => r.uid).length;
  const covered = data.to >= data.activityFrom;

  const header = (key: SortKey, label: string) => (
    <th key={key} scope="col" aria-sort={sort.key === key ? (sort.desc ? 'descending' : 'ascending') : 'none'} className="px-3 py-2.5 text-right">
      <button
        type="button"
        onClick={() => setSort(s => ({ key, desc: s.key === key ? !s.desc : !ASCENDING_FIRST.has(key) }))}
        className={cn('inline-flex items-center gap-1 rounded-sm hover:text-white focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50', HEAD)}
      >
        {label}
        {sort.key === key && (sort.desc ? <ArrowDown className="size-3" aria-hidden /> : <ArrowUp className="size-3" aria-hidden />)}
      </button>
    </th>
  );

  return (
    <div className="space-y-6">
      {/* ── What needs a look ── */}
      <section aria-labelledby="flags-heading" className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="flags-heading" className="text-sm font-semibold">What needs a look</h2>
          <p className="text-[11px] text-zinc-400">Leads, not verdicts — each opens the report with the minutes behind it.</p>
        </div>
        <FlagList
          flags={flags}
          withNames
          hrefFor={f => hrefFor(f.uid)}
          cleanLine={
            covered
              ? `${agents} ${agents === 1 ? 'agent' : 'agents'}, no flags this period.`
              : 'BuddyX activity starts after this period, so there is nothing to check.'
          }
        />
        {data.hourlyFrom && data.hourlyFrom > data.from && covered && (
          <p className="text-[11px] text-zinc-400">
            Hour-by-hour BuddyX data starts {formatDayLabelWithWeekday(data.hourlyFrom)}; earlier days are judged on daily totals, which can only overstate coverage.
          </p>
        )}
      </section>

      {/* ── Coverage ── */}
      {covered && (
        <section className={cn('rounded-xl p-5', SURFACE)} aria-labelledby="coverage-heading">
          <h2 id="coverage-heading" className="text-sm font-semibold">Online in BuddyX while clocked in</h2>
          <p className="mt-0.5 text-[11px] text-zinc-400">
            One dot per agent. Clocked working hours across — breaks, idle and pause excluded — and the hours of it they were online in BuddyX up.
            Online time outside clocked time does not count.
          </p>
          <CoverageScatter rows={data.leaderboard ?? []} hrefFor={hrefFor} />
        </section>
      )}

      {/* ── Every agent ── */}
      <section className={cn('rounded-xl p-5', SURFACE)} aria-labelledby="leaderboard">
        <h2 id="leaderboard" className="text-sm font-semibold">Every agent</h2>
        <p className="mt-0.5 text-[11px] text-zinc-400">
          Coverage is BuddyX online time inside Bluu clocked working time. Open an agent for their shifts, minute by minute.
        </p>
        <div
          tabIndex={0}
          role="region"
          aria-label="Agent table, scrollable"
          className="mt-3 overflow-x-auto rounded-lg border border-white/[0.07] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/50"
        >
          <table className="w-full min-w-[1180px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-white/[0.07]">
                <th scope="col" className={cn('sticky left-0 z-10 bg-[var(--card)] px-3 py-2.5 text-left', HEAD)}>Agent</th>
                {header('coverage', 'Coverage')}
                <th scope="col" className={cn('px-3 py-2.5 text-right', HEAD)}>Flags</th>
                {COLUMNS.map(col => header(col.key, col.label))}
                <th scope="col" className={cn('px-3 py-2.5 text-right', HEAD)}>Mass msgs</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.045]">
              {rows.map(r => (
                // The whole row opens the report (the table's main action); the
                // name link is the keyboard and screen-reader route to the same
                // place. The sticky cell is opaque, so its wash is a `before:`
                // overlay (DESIGN.md §5, the shaded matrix).
                <tr
                  key={r.uid ?? r.chatterId}
                  onClick={r.uid ? () => router.push(hrefFor(r.uid!)) : undefined}
                  className={cn('group', r.uid && 'cursor-pointer hover:bg-white/[0.055] active:bg-white/[0.08]')}
                >
                  <td className="sticky left-0 z-10 bg-[var(--card)] px-3 py-2 before:absolute before:inset-0 before:transition-colors group-hover:before:bg-white/[0.055]">
                    {r.uid ? (
                      <Link
                        href={hrefFor(r.uid)}
                        prefetch={false}
                        onClick={e => e.stopPropagation()}
                        className="relative inline-flex rounded-md focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                        aria-label={`Open ${r.name}’s report`}
                      >
                        <PersonTag name={r.name} photoURL={null} size="sm" />
                      </Link>
                    ) : (
                      <span className="relative text-xs text-zinc-400">{r.name}</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                    {r.coverage?.ratio != null ? (
                      <>
                        <span className={r.coverage.ratio < COVERAGE_FLAG_RATIO ? 'text-orange-400' : undefined}>{formatShare(r.coverage.ratio)}</span>
                        <span className="block text-[11px] text-zinc-400">
                          {formatDuration(r.coverage.onlineWhileClockedMs)} of {formatDuration(r.coverage.clockedMs)}
                        </span>
                      </>
                    ) : (
                      <span className="text-zinc-400">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <FlagChips flags={r.uid ? flagsByUid.get(r.uid) ?? [] : []} />
                  </td>
                  {COLUMNS.map(col => (
                    <td key={col.key} className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{col.render(r)}</td>
                  ))}
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                    {r.mass.count}
                    {r.mass.unsent > 0 && <span className="text-[11px] text-zinc-400"> · {r.mass.unsent} unsent</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
