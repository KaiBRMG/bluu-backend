'use client';

import { useMemo, useState } from 'react';
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
import { useAuthFetch } from '@/hooks/useAuthFetch';
import { useBuddyxAnalytics } from '@/hooks/useBuddyxAnalytics';
import { formatUsd } from '@/lib/salary/salaryFormat';
import { formatDayLabelWithWeekday } from '@/lib/salary/salaryDate';
import { formatCount, formatDuration, formatRate } from '@/lib/buddyx/analyticsFormat';
import { SALE_KIND_COLORS } from '@/lib/buddyx/chartColors';
import type { BenchmarkKey, ChatterAnalytics, ChatterLeaderboardRow, ChatterPeriod } from '@/lib/buddyx/analyticsTypes';

/**
 * Chatter Analytics — `/ca-portal/chatter-analytics`.
 *
 * An agent asks "how am I doing against the team?"; an admin asks "who's
 * carrying, who's slipping, and does BuddyX online time match our clock?".
 * Question-led sections under a standing KPI row. The agent's comparison is
 * anonymous by construction — the server sends a median and a quartile, never
 * a colleague (D8) — and the admin's leaderboard is the only named view.
 */

const PERIODS: Array<{ value: ChatterPeriod; label: string }> = [
  { value: 'mtd', label: 'MTD' },
  { value: 'prev-month', label: 'Last month' },
  { value: '7d', label: '7d' },
  { value: '30d', label: '30d' },
  { value: 'custom', label: 'Custom' },
];

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
  const [period, setPeriod] = useState<ChatterPeriod>('mtd');
  const [from, setFrom] = useState<Date | undefined>(undefined);
  const [to, setTo] = useState<Date | undefined>(undefined);

  const url = useMemo(() => {
    if (period !== 'custom') return `/api/analytics/chatters?period=${period}`;
    if (!from || !to || to < from) return null;
    return `/api/analytics/chatters?period=custom&from=${format(from, 'yyyy-MM-dd')}&to=${format(to, 'yyyy-MM-dd')}`;
  }, [period, from, to]);
  const { data, loading, error, reload } = useBuddyxAnalytics<ChatterAnalytics>(url);

  return (
    <AppLayout>
      <div className="max-w-7xl space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Chatter Analytics</h1>
            <p className="mt-1 text-sm text-zinc-400">
              {data?.leaderboard ? 'Every chat agent, from BuddyX.' : 'How you are doing against the team, from BuddyX.'} Money is
              gross — what fans paid; net is 80% after OnlyFans&apos; 20%.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <ToggleGroup type="single" variant="outline" size="sm" value={period} onValueChange={v => v && setPeriod(v as ChatterPeriod)} aria-label="Period">
              {PERIODS.map(p => <ToggleGroupItem key={p.value} value={p.value} className={SEGMENT}>{p.label}</ToggleGroupItem>)}
            </ToggleGroup>
            <SyncStatus scope="chatters" onSynced={() => void reload(true)} />
          </div>
        </div>

        {period === 'custom' && (
          <div className="flex flex-wrap items-center gap-2">
            <DatePicker value={from} onChange={setFrom} placeholder="From" className="h-8 w-44 text-sm" />
            <DatePicker value={to} onChange={setTo} placeholder="To" className="h-8 w-44 text-sm" />
            <p className="text-[11px] text-zinc-400">Up to 92 days. Totals are summed from days.</p>
          </div>
        )}

        {!url ? (
          <p className="text-sm text-zinc-400">Pick a start and an end day.</p>
        ) : loading && !data ? (
          <PageSkeleton />
        ) : error && !data ? (
          <LoadError error={error} onRetry={() => void reload(true)} />
        ) : data ? (
          <ChatterBody data={data} onPulled={() => void reload(true)} />
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


function ChatterBody({ data, onPulled }: { data: ChatterAnalytics; onPulled: () => void }) {
  const me = data.me;
  const isAdmin = data.leaderboard !== null;

  return (
    <div className="space-y-6">
      {/* ── KPI row ── */}
      {me ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
          <KpiTile label="PPV revenue" basis="gross" tip={PPV_ATTRIBUTION} value={formatUsd(me.ppvGross)} meta={`${formatCount(me.ppvsUnlocked)} unlocked`} />
          <KpiTile label="Tips" basis="gross" tip={TIPS_ATTRIBUTION} value={formatUsd(me.tipsGross)} meta={`${formatCount(me.tipsCount)} tips`} />
          <KpiTile label="Unlock rate" value={formatRate(me.unlockRate, 1)} meta={`${formatCount(me.ppvsSent)} PPVs sent`} />
          <KpiTile label="Median reply time" value={formatDuration(me.medianResponseTimeMs)} meta={me.p75ResponseTimeMs !== null ? `3 in 4 within ${formatDuration(me.p75ResponseTimeMs)}` : undefined} />
          <KpiTile label="Online time" value={formatDuration(me.onlineMs)} meta={me.revenuePerOnlineHour !== null ? `${formatUsd(me.revenuePerOnlineHour)} gross per online hour` : undefined} />
        </div>
      ) : (
        !isAdmin && <p className="text-sm text-zinc-400">Your BuddyX account is not linked to you yet, so there are no figures to show. Ask an admin to link it.</p>
      )}

      {!data.hasMedians && (
        <CustomMedianNote data={data} isAdmin={isAdmin} onPulled={onPulled} />
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
              {data.benchmarks.map(b => (
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

      {isAdmin && <AdminView data={data} />}
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

type SortKey = 'revenue' | 'ppvGross' | 'tipsGross' | 'unlockRate' | 'medianResponseTimeMs' | 'onlineMs' | 'revenuePerOnlineHour' | 'revenuePerAccount';

const COLUMNS: Array<{ key: SortKey; label: string; render: (r: ChatterLeaderboardRow) => string }> = [
  { key: 'revenue', label: 'Gross', render: r => formatUsd(r.ppvGross + r.tipsGross) },
  { key: 'ppvGross', label: 'PPV gross', render: r => formatUsd(r.ppvGross) },
  { key: 'tipsGross', label: 'Tips gross', render: r => formatUsd(r.tipsGross) },
  { key: 'unlockRate', label: 'Unlock', render: r => formatRate(r.unlockRate, 1) },
  { key: 'medianResponseTimeMs', label: 'Reply', render: r => formatDuration(r.medianResponseTimeMs) },
  { key: 'onlineMs', label: 'Online', render: r => formatDuration(r.onlineMs) },
  { key: 'revenuePerOnlineHour', label: 'Gross / online h', render: r => (r.revenuePerOnlineHour === null ? '—' : formatUsd(r.revenuePerOnlineHour)) },
  { key: 'revenuePerAccount', label: 'Gross / account', render: r => (r.revenuePerAccount === null ? '—' : formatUsd(r.revenuePerAccount)) },
];

function sortValue(r: ChatterLeaderboardRow, key: SortKey): number {
  if (key === 'revenue') return r.ppvGross + r.tipsGross;
  const v = r[key];
  return typeof v === 'number' ? v : -Infinity;
}

/** "online 31h · clocked 44h" — a fact, stated only past a 15% gap. */
function clockGap(r: ChatterLeaderboardRow): { text: string; large: boolean } | null {
  if (r.clockedMs === null || r.clockedMs <= 0) return null;
  const gap = Math.abs(r.onlineMs - r.clockedMs) / r.clockedMs;
  if (gap <= 0.15) return null;
  return { text: `online ${formatDuration(r.onlineMs)} · clocked ${formatDuration(r.clockedMs)}`, large: gap > 0.4 };
}

function AdminView({ data }: { data: ChatterAnalytics }) {
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'revenue', desc: true });
  const rows = useMemo(() => {
    const list = [...(data.leaderboard ?? [])];
    list.sort((a, b) => {
      const d = sortValue(a, sort.key) - sortValue(b, sort.key);
      return sort.desc ? -d : d;
    });
    return list;
  }, [data.leaderboard, sort]);

  return (
    <div className="space-y-4">
      {data.rosteredOffline && data.rosteredOffline.length > 0 && (
        <section aria-label="Rostered but never online" className="rounded-xl border border-orange-500/20 bg-orange-500/[0.06] px-4 py-3">
          <ul className="space-y-1">
            {data.rosteredOffline.map(a => (
              <li key={a.uid} className="flex items-center gap-2 text-sm">
                <span className="inline-block size-1.5 rounded-full bg-orange-400" aria-hidden />
                {a.name} was rostered on {a.shifts} {a.shifts === 1 ? 'shift' : 'shifts'} and never online in BuddyX
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className={cn('rounded-xl p-5', SURFACE)} aria-labelledby="leaderboard">
        <h2 id="leaderboard" className="text-sm font-semibold">Every agent</h2>
        <p className="mt-0.5 text-[11px] text-zinc-400">
          Online time is BuddyX&apos;s; clocked time is Bluu&apos;s time tracking. A gap over 15% is stated beside the agent.
        </p>
        <div
          tabIndex={0}
          role="region"
          aria-label="Agent leaderboard, scrollable"
          className="mt-3 overflow-x-auto rounded-lg border border-white/[0.07] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/50"
        >
          <table className="w-full min-w-[980px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-white/[0.07]">
                <th scope="col" className="sticky left-0 z-10 bg-[var(--card)] px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Agent</th>
                {COLUMNS.map(col => (
                  <th key={col.key} scope="col" aria-sort={sort.key === col.key ? (sort.desc ? 'descending' : 'ascending') : 'none'} className="px-3 py-2.5 text-right">
                    <button
                      type="button"
                      onClick={() => setSort(s => ({ key: col.key, desc: s.key === col.key ? !s.desc : col.key !== 'medianResponseTimeMs' }))}
                      className="inline-flex items-center gap-1 rounded-sm text-[11px] font-semibold uppercase tracking-wide text-zinc-400 hover:text-white focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    >
                      {col.label}
                      {sort.key === col.key && (sort.desc ? <ArrowDown className="size-3" aria-hidden /> : <ArrowUp className="size-3" aria-hidden />)}
                    </button>
                  </th>
                ))}
                <th scope="col" className="px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Mass msgs</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.045]">
              {rows.map(r => {
                const gap = clockGap(r);
                return (
                  <tr key={r.uid ?? r.chatterId}>
                    <td className="sticky left-0 z-10 bg-[var(--card)] px-3 py-2">
                      {r.uid ? <PersonTag name={r.name} photoURL={null} size="sm" /> : <span className="text-xs text-zinc-400">{r.name}</span>}
                      {gap && <span className={cn('block text-[11px]', gap.large ? 'text-orange-400' : 'text-zinc-400')}>{gap.text}</span>}
                    </td>
                    {COLUMNS.map(col => (
                      <td key={col.key} className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{col.render(r)}</td>
                    ))}
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                      {r.mass.count}
                      {r.mass.unsent > 0 && <span className="text-[11px] text-zinc-400"> · {r.mass.unsent} unsent</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
