'use client';

import { useState } from 'react';
import { format, subDays } from 'date-fns';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ReferenceLine, XAxis, YAxis } from 'recharts';
import AppLayout from '@/components/AppLayout';
import { cn } from '@/lib/utils';
import { SURFACE } from '@/lib/surfaces';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';
import { DatePicker } from '@/components/smm/shared/DatePicker';
import { SyncStatus } from '@/components/buddyx/SyncStatus';
import { SourceMixBar } from '@/components/buddyx/SourceMixBar';
import { LegendSwatch, KpiTile, Fact, LoadError, SEGMENT, LINK_REVENUE_NOTE } from '@/components/buddyx/buddyxUi';
import { CreatorAvatar, CreatorChip } from '@/components/creators/CreatorChip';
import { Sparkline } from '@/components/growth/Sparkline';
import { useCreatorMap } from '@/hooks/useCreators';
import { useBuddyxAnalytics } from '@/hooks/useBuddyxAnalytics';
import { formatUsd } from '@/lib/salary/salaryFormat';
import { formatDayLabelWithWeekday } from '@/lib/salary/salaryDate';
import { formatCount, formatDuration, formatShare } from '@/lib/buddyx/analyticsFormat';
import { CREATOR_HISTORY_START_DAY } from '@/lib/buddyx/constants';
import { SEQUENTIAL_COLOR, SOURCE_MIX_COLORS } from '@/lib/buddyx/chartColors';
import type { CreatorAnalytics } from '@/lib/buddyx/analyticsTypes';

/**
 * OnlyFans Analytics — `/creator-portal/onlyfans-analytics` (internal only).
 *
 * "Where does each creator's money come from, and which acquisition spend
 * works?" **Roster first**, on the metric-roster pattern (DESIGN.md §5): one
 * card per creator with its own-scale sparkline and a source-mix bar; selecting
 * a card scopes everything below it. The history runs back to October 2025 as
 * one series — the Infloww import kept only the fields BuddyX continues — and
 * the cutover is drawn where the source changes.
 */

type Preset = 'mtd' | '30d' | '90d' | 'all' | 'custom';
const PRESETS: Array<{ value: Preset; label: string }> = [
  { value: 'mtd', label: 'MTD' },
  { value: '30d', label: '30d' },
  { value: '90d', label: '90d' },
  { value: 'all', label: 'Since Oct 2025' },
  { value: 'custom', label: 'Custom' },
];

const earningsConfig = {
  subsGross: { label: 'Subscriptions', color: SOURCE_MIX_COLORS.subs },
  tipsGross: { label: 'Tips', color: SOURCE_MIX_COLORS.tips },
  messagesGross: { label: 'Messages', color: SOURCE_MIX_COLORS.messages },
} satisfies ChartConfig;

// New / returning / trial reuse the same validated three in fixed order.
const subsConfig = {
  new: { label: 'New', color: SOURCE_MIX_COLORS.messages },
  returning: { label: 'Returning', color: SOURCE_MIX_COLORS.tips },
  trial: { label: 'Free trial', color: SOURCE_MIX_COLORS.subs },
} satisfies ChartConfig;

const newSubsConfig = { newSubs: { label: 'New subscribers', color: SEQUENTIAL_COLOR } } satisfies ChartConfig;

function rangeFor(preset: Preset, from?: Date, to?: Date): { from: string; to: string } | null {
  const today = new Date();
  const fmt = (d: Date) => format(d, 'yyyy-MM-dd');
  switch (preset) {
    case 'mtd':
      return { from: format(today, 'yyyy-MM-01'), to: fmt(today) };
    case '30d':
      return { from: fmt(subDays(today, 29)), to: fmt(today) };
    case '90d':
      return { from: fmt(subDays(today, 89)), to: fmt(today) };
    case 'all':
      return { from: CREATOR_HISTORY_START_DAY, to: fmt(today) };
    case 'custom':
      return from && to && to >= from ? { from: fmt(from), to: fmt(to) } : null;
  }
}

export default function OnlyFansAnalyticsPage() {
  const [preset, setPreset] = useState<Preset>('mtd');
  const [from, setFrom] = useState<Date | undefined>();
  const [to, setTo] = useState<Date | undefined>();
  const [creatorId, setCreatorId] = useState<string | null>(null);

  const range = rangeFor(preset, from, to);
  const url = range
    ? `/api/analytics/creators?from=${range.from}&to=${range.to}${creatorId ? `&creatorId=${encodeURIComponent(creatorId)}` : ''}`
    : null;
  const { data, loading, error, reload } = useBuddyxAnalytics<CreatorAnalytics>(url);

  return (
    <AppLayout>
      <div className="max-w-7xl space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">OnlyFans Analytics</h1>
            <p className="mt-1 text-sm text-zinc-400">Each creator&apos;s earnings, subscribers and links — Infloww history, then BuddyX. Earnings are gross (what fans paid); net is 80% after OnlyFans&apos; 20%.</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <ToggleGroup type="single" variant="outline" size="sm" value={preset} onValueChange={v => v && setPreset(v as Preset)} aria-label="Date range">
              {PRESETS.map(p => <ToggleGroupItem key={p.value} value={p.value} className={SEGMENT}>{p.label}</ToggleGroupItem>)}
            </ToggleGroup>
            <SyncStatus scope="creators" onSynced={() => void reload(true)} />
          </div>
        </div>

        {preset === 'custom' && (
          <div className="flex flex-wrap items-center gap-2">
            <DatePicker value={from} onChange={setFrom} placeholder="From" className="h-8 w-44 text-sm" />
            <DatePicker value={to} onChange={setTo} placeholder="To" className="h-8 w-44 text-sm" />
          </div>
        )}

        {!url ? (
          <p className="text-sm text-zinc-400">Pick a start and an end day.</p>
        ) : loading && !data ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">{[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-[92px] rounded-xl" />)}</div>
            <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 250px), 1fr))' }}>
              {[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-36 rounded-xl" />)}
            </div>
          </div>
        ) : error && !data ? (
          <LoadError error={error} onRetry={() => void reload(true)} />
        ) : data ? (
          <Body data={data} selected={creatorId} onSelect={setCreatorId} />
        ) : null}
      </div>
    </AppLayout>
  );
}


function Body({ data, selected, onSelect }: { data: CreatorAnalytics; selected: string | null; onSelect: (id: string | null) => void }) {
  const creators = useCreatorMap();
  const name = (id: string | null) => (id ? creators.get(id)?.stageName ?? 'Unknown creator' : 'All creators');
  const showCutover = data.from < data.cutoverDay && data.to >= data.cutoverDay;
  const subscriberDays = data.daily.filter(d => d.day < data.subscribersFrom);

  return (
    <>
      {/* ── Standing KPIs: range-independent on purpose (the metric-roster rule) ── */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiTile label="Earnings MTD" basis="gross" value={formatUsd(data.kpis.earningsMtd)} />
        <KpiTile label="New subscribers MTD" value={formatCount(data.kpis.newSubsMtd)} />
        <KpiTile
          label="Best link by revenue per fan"
          tip={LINK_REVENUE_NOTE}
          value={data.kpis.bestLink ? formatUsd(data.kpis.bestLink.revenuePerFan) : '—'}
          meta={data.kpis.bestLink ? `${data.kpis.bestLink.name ?? 'Unnamed link'} · ${name(data.kpis.bestLink.creatorId)}` : 'No link with 5+ fans yet'}
        />
        <KpiTile label="Creators active in BuddyX" value={String(data.kpis.activeCreators)} meta="Streamed stats in the last 7 days" />
      </div>

      {/* ── Roster (focal) ── */}
      <section aria-labelledby="roster" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="roster" className="text-sm font-semibold">Creators</h2>
          <div className="flex items-center gap-3 text-xs text-zinc-300">
            <span className="inline-flex items-center gap-1.5"><LegendSwatch color={SOURCE_MIX_COLORS.subs} /> Subscriptions</span>
            <span className="inline-flex items-center gap-1.5"><LegendSwatch color={SOURCE_MIX_COLORS.tips} /> Tips</span>
            <span className="inline-flex items-center gap-1.5"><LegendSwatch color={SOURCE_MIX_COLORS.messages} /> Messages</span>
            {selected && (
              <Button size="xs" variant="ghost" className="text-zinc-300" onClick={() => onSelect(null)}>All creators</Button>
            )}
          </div>
        </div>
        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 250px), 1fr))' }}>
          {data.roster.map(card => {
            const isSelected = selected === card.creatorId;
            const delta = card.previousGross !== null && card.previousGross > 0 ? (card.totalGross - card.previousGross) / card.previousGross : null;
            return (
              <button
                key={card.creatorId}
                type="button"
                aria-pressed={isSelected}
                onClick={() => onSelect(isSelected ? null : card.creatorId)}
                className={cn(
                  'flex flex-col gap-2 rounded-xl border p-3 text-left transition-colors duration-[120ms] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                  isSelected
                    ? 'border-action-blue bg-white/[0.07]'
                    : 'border-white/[0.07] bg-white/[0.025] hover:bg-white/[0.055] active:bg-white/[0.08]',
                )}
              >
                <span className="flex items-center gap-2">
                  <CreatorAvatar creatorId={card.creatorId} className="size-6" />
                  <span className="min-w-0 truncate text-sm font-medium">{name(card.creatorId)}</span>
                </span>
                <span className="flex items-baseline justify-between gap-2">
                  <span className="text-lg font-semibold tabular-nums">
                    {formatUsd(card.totalGross)} <span className="text-[11px] font-normal text-zinc-400">gross</span>
                  </span>
                  <span className="text-[11px] tabular-nums text-zinc-400">
                    {delta === null ? '—' : `${delta >= 0 ? '+' : '−'}${Math.abs(Math.round(delta * 100))}% vs previous`}
                  </span>
                </span>
                <Sparkline
                  points={card.spark.filter(p => p.value !== null).map(p => ({ date: p.day, value: p.value as number }))}
                  width={480}
                  height={28}
                  zeroBased
                  className="w-full"
                />
                <SourceMixBar subs={card.subsGross} tips={card.tipsGross} messages={card.messagesGross} />
              </button>
            );
          })}
        </div>
      </section>

      <p className="text-sm text-zinc-400">
        Showing <span className="text-foreground">{name(selected)}</span> below.
      </p>

      {/* ── 1. Earnings by source ── */}
      <section className={cn('rounded-xl p-5', SURFACE)} aria-labelledby="earnings">
        <h2 id="earnings" className="text-sm font-semibold">Gross earnings by source</h2>
        <p className="mt-0.5 text-[11px] text-zinc-400">
          Gross per day — net is 80% of each. Days with no data are gaps, not zeros.
          {showCutover && ' The hairline marks where Infloww history ends and BuddyX begins.'}
        </p>
        {data.daily.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-400">No creator statistics in this range.</p>
        ) : (
          <ChartContainer config={earningsConfig} className="mt-3 h-[240px] w-full">
            <AreaChart data={data.daily} margin={{ left: 4, right: 8, top: 16 }}>
              <CartesianGrid vertical={false} strokeOpacity={0.15} />
              <XAxis dataKey="day" tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} tickFormatter={d => String(d).slice(5)} />
              <YAxis tickLine={false} axisLine={false} width={56} tickFormatter={v => `$${v}`} />
              <ChartTooltip content={<ChartTooltipContent labelFormatter={l => formatDayLabelWithWeekday(String(l))} formatter={(v, n) => [` ${formatUsd(Number(v))}`, earningsConfig[n as keyof typeof earningsConfig]?.label ?? String(n)]} />} />
              {showCutover && (
                <ReferenceLine x={data.cutoverDay} stroke="rgba(255,255,255,0.35)" strokeDasharray="3 3" label={{ value: 'Infloww → BuddyX', position: 'insideTopLeft', fill: '#a1a1aa', fontSize: 11 }} />
              )}
              <Area dataKey="subsGross" stackId="s" type="monotone" stroke="var(--color-subsGross)" strokeWidth={2} fill="var(--color-subsGross)" fillOpacity={0.35} connectNulls={false} />
              <Area dataKey="tipsGross" stackId="s" type="monotone" stroke="var(--color-tipsGross)" strokeWidth={2} fill="var(--color-tipsGross)" fillOpacity={0.35} connectNulls={false} />
              <Area dataKey="messagesGross" stackId="s" type="monotone" stroke="var(--color-messagesGross)" strokeWidth={2} fill="var(--color-messagesGross)" fillOpacity={0.35} connectNulls={false} />
            </AreaChart>
          </ChartContainer>
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* ── 2. Subscribers ── */}
        <section className={cn('rounded-xl p-5', SURFACE)} aria-labelledby="subscribers">
          <h2 id="subscribers" className="text-sm font-semibold">Subscribers</h2>
          <p className="mt-0.5 text-[11px] text-zinc-400">
            New, returning and free-trial subscribers by day, from BuddyX (from 25 Sep 2026).
            {subscriberDays.length > 0 && ' Earlier days show total new subscribers only.'}
          </p>
          {subscriberDays.length > 0 && (
            <ChartContainer config={newSubsConfig} className="mt-3 h-[120px] w-full">
              <BarChart data={subscriberDays} margin={{ left: 4, right: 8, top: 8 }}>
                <XAxis dataKey="day" tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} tickFormatter={d => String(d).slice(5)} />
                <YAxis tickLine={false} axisLine={false} width={32} allowDecimals={false} />
                <ChartTooltip content={<ChartTooltipContent labelFormatter={l => formatDayLabelWithWeekday(String(l))} />} />
                <Bar dataKey="newSubs" fill="var(--color-newSubs)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ChartContainer>
          )}
          {data.subscribers.length === 0 ? (
            <p className="mt-3 text-sm text-zinc-400">No subscriber events in this range.</p>
          ) : (
            <>
              <div className="mt-3 flex items-center gap-3 text-xs text-zinc-300">
                <span className="inline-flex items-center gap-1.5"><LegendSwatch color={SOURCE_MIX_COLORS.messages} /> New</span>
                <span className="inline-flex items-center gap-1.5"><LegendSwatch color={SOURCE_MIX_COLORS.tips} /> Returning</span>
                <span className="inline-flex items-center gap-1.5"><LegendSwatch color={SOURCE_MIX_COLORS.subs} /> Free trial</span>
              </div>
              <ChartContainer config={subsConfig} className="mt-2 h-[180px] w-full">
                <BarChart data={data.subscribers} margin={{ left: 4, right: 8, top: 8 }}>
                  <CartesianGrid vertical={false} strokeOpacity={0.15} />
                  <XAxis dataKey="day" tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} tickFormatter={d => String(d).slice(5)} />
                  <YAxis tickLine={false} axisLine={false} width={32} allowDecimals={false} />
                  <ChartTooltip content={<ChartTooltipContent labelFormatter={l => formatDayLabelWithWeekday(String(l))} />} />
                  <Bar dataKey="new" stackId="s" fill="var(--color-new)" stroke="var(--card)" strokeWidth={2} />
                  <Bar dataKey="returning" stackId="s" fill="var(--color-returning)" stroke="var(--card)" strokeWidth={2} />
                  <Bar dataKey="trial" stackId="s" fill="var(--color-trial)" stroke="var(--card)" strokeWidth={2} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ChartContainer>
            </>
          )}
        </section>

        {/* ── 4. Messaging on this creator ── */}
        <section className={cn('rounded-xl p-5', SURFACE)} aria-labelledby="messaging">
          <h2 id="messaging" className="text-sm font-semibold">Messaging</h2>
          <dl className="mt-3 grid grid-cols-2 gap-x-8 gap-y-3">
            <Fact label="Fans chatted" value={formatCount(data.messaging.fansChatted)} />
            <Fact label="PPVs sent → unlocked" value={`${formatCount(data.messaging.ppvsSent)} → ${formatCount(data.messaging.ppvsUnlocked)}`} />
            <Fact label="Mass messages" value={formatCount(data.mass.count)} meta={data.mass.avgPrice !== null ? `avg list price ${formatUsd(data.mass.avgPrice)}` : 'all free'} />
            <Fact label="Unsend rate" value={formatShare(data.mass.unsentRate)} />
            <Fact
              label="Median reply time"
              value={formatDuration(data.messaging.replyTimeMs)}
              meta={showCutover ? 'BuddyX days only — Infloww reported an average, not a median' : undefined}
            />
          </dl>
          {data.revShareGross !== null && (
            <div className="mt-4 border-t border-white/[0.07] pt-3">
              <Fact label="Rev share owed (BuddyX, gross)" value={formatUsd(data.revShareGross)} />
            </div>
          )}
        </section>
      </div>

      {/* ── 3. Links ── */}
      <section className={cn('rounded-xl p-5', SURFACE)} aria-labelledby="links">
        <h2 id="links" className="text-sm font-semibold">Links</h2>
        <p className="mt-0.5 text-[11px] text-zinc-400">
          Tracking and free-trial links, by revenue — as BuddyX reports it; its API does not say whether link revenue is gross or net. The trend is new revenue per day since the link was first synced. ROI is (revenue − cost) ÷ cost; a free link shows “—”.
        </p>
        {data.links.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-400">No links synced for {name(selected)}.</p>
        ) : (
          <div tabIndex={0} role="region" aria-label="Links, scrollable" className="mt-3 overflow-x-auto rounded-lg border border-white/[0.07] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/50">
            <table className="w-full min-w-[1000px] text-sm">
              <thead>
                <tr className="border-b border-white/[0.07] text-[11px] uppercase tracking-wide text-zinc-400">
                  {['Link', 'Creator', 'Clicks → subs', 'Subs', 'Revenue (as reported)', 'Per fan', 'Cost', 'ROI', 'Stackers', 'Trend'].map((h, i) => (
                    <th key={h} scope="col" className={cn('px-3 py-2.5 font-semibold', i < 2 ? 'text-left' : 'text-right')}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.045]">
                {data.links.slice(0, 60).map(l => (
                  <tr key={`${l.creatorId}-${l.linkId}`} className={cn(l.archived && 'text-zinc-400')}>
                    <td className="max-w-[16rem] px-3 py-2">
                      <span className="block truncate" title={l.url ?? undefined}>{l.name ?? l.linkId}</span>
                      <span className="text-[11px] text-zinc-400">{l.kind === 'free-trial' ? 'Free trial' : 'Tracking'}{l.archived ? ' · archived' : ''}</span>
                    </td>
                    <td className="px-3 py-2">{l.creatorId ? <CreatorChip creatorId={l.creatorId} size="xs" /> : '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {l.transitions === null ? '—' : `${formatCount(l.transitions)} → ${formatCount(l.subscribers)}`}
                      {l.conversion !== null && <span className="block text-[11px] text-zinc-400">{formatShare(l.conversion)}</span>}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatCount(l.subscribers)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatUsd(l.revenue)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{l.revenuePerFan === null ? '—' : formatUsd(l.revenuePerFan)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{l.cost > 0 ? formatUsd(l.cost) : '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{l.roi === null ? '—' : `${Math.round(l.roi * 100)}%`}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{l.stackers === null ? '—' : formatCount(l.stackers)}</td>
                    <td className="px-3 py-2 text-right">
                      <Sparkline points={l.spark.map(p => ({ date: p.day, value: p.value }))} width={88} height={20} zeroBased />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── Comparison ── */}
      {data.comparison.length > 0 && (
        <section className={cn('rounded-xl p-5', SURFACE)} aria-labelledby="comparison">
          <h2 id="comparison" className="text-sm font-semibold">Creators compared</h2>
          <table className="mt-3 w-full text-sm">
            <thead>
              <tr className="border-b border-white/[0.07] text-[11px] uppercase tracking-wide text-zinc-400">
                <th scope="col" className="px-3 py-2 text-left font-semibold">Creator</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">Earnings (gross)</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">Share</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">vs previous period</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.045]">
              {data.comparison.map(row => (
                <tr key={row.creatorId}>
                  <td className="px-3 py-2"><CreatorChip creatorId={row.creatorId} size="xs" /></td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatUsd(row.gross)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatShare(row.share)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-zinc-400">
                    {row.previousGross === null || row.previousGross === 0 ? '—' : `${row.gross >= row.previousGross ? '+' : '−'}${Math.abs(Math.round(((row.gross - row.previousGross) / row.previousGross) * 100))}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}


