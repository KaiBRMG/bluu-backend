'use client';

import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import AppLayout from '@/components/AppLayout';
import { cn } from '@/lib/utils';
import { SURFACE } from '@/lib/surfaces';
import { Skeleton } from '@/components/ui/skeleton';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';
import { SyncStatus } from '@/components/buddyx/SyncStatus';
import { CreatorCombobox } from '@/components/buddyx/CreatorCombobox';
import { FanDrawer } from '@/components/buddyx/FanDrawer';
import { FanLabel, LegendSwatch, KpiTile, LoadError, SEGMENT } from '@/components/buddyx/buddyxUi';
import { CreatorChip } from '@/components/creators/CreatorChip';
import { useBuddyxAnalytics } from '@/hooks/useBuddyxAnalytics';
import { useViewerTimezone } from '@/hooks/useViewerTimezone';
import { formatUsd, pluralise } from '@/lib/salary/salaryFormat';
import { daysAgo, formatShare } from '@/lib/buddyx/analyticsFormat';
import { SALE_KIND_COLORS, SEQUENTIAL_COLOR } from '@/lib/buddyx/chartColors';
import type { FanAnalytics, FanPeriod, FanSummary } from '@/lib/buddyx/analyticsTypes';

/**
 * Fan Analytics — `/ca-portal/fan-analytics`.
 *
 * An agent asks "who should I be messaging?"; an admin asks "how healthy is
 * each creator's fan base, and where do good fans come from?". The focal
 * section is **Worth a message**: people who spent recently and then went
 * quiet. Agents see the creators they are rostered on this month; the server
 * enforces it (D9).
 */

const PERIODS: Array<{ value: FanPeriod; label: string }> = [
  { value: 'month', label: 'This month' },
  { value: 'prev-month', label: 'Last month' },
  { value: '3m', label: '3 months' },
  { value: 'lifetime', label: 'Lifetime' },
];
const USUAL: Record<string, string> = { tips: 'Tips', ppv: 'PPVs', mixed: 'Tips & PPVs' };

const distributionConfig = { fans: { label: 'Spenders', color: SEQUENTIAL_COLOR } } satisfies ChartConfig;

export default function FanAnalyticsPage() {
  const { timezone } = useViewerTimezone();
  const [period, setPeriod] = useState<FanPeriod>('month');
  const [creatorId, setCreatorId] = useState<string | null>(null);
  const [lifetimeTop, setLifetimeTop] = useState(false);
  const [openFan, setOpenFan] = useState<{ creatorId: string; fanId: string } | null>(null);

  const url = `/api/analytics/fans?period=${period}${creatorId ? `&creatorId=${encodeURIComponent(creatorId)}` : ''}`;
  const { data, loading, error, reload } = useBuddyxAnalytics<FanAnalytics>(url);

  return (
    <AppLayout>
      <div className="max-w-7xl space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Fan Analytics</h1>
            <p className="mt-1 text-sm text-zinc-400">
              {data?.acquisition ? 'Every creator’s fans.' : 'Fans of the creators you are rostered on this month.'} Spend is gross — what fans paid; net is 80% after OnlyFans&apos; 20%. Updated daily.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {data && data.scope.length > 1 && (
              <CreatorCombobox value={creatorId} onChange={setCreatorId} allowedIds={data.scope} allLabel="All my creators" />
            )}
            <ToggleGroup type="single" variant="outline" size="sm" value={period} onValueChange={v => v && setPeriod(v as FanPeriod)} aria-label="Period">
              {PERIODS.map(p => <ToggleGroupItem key={p.value} value={p.value} className={SEGMENT}>{p.label}</ToggleGroupItem>)}
            </ToggleGroup>
            <SyncStatus scope="fans" onSynced={() => void reload(true)} />
          </div>
        </div>

        {loading && !data ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">{[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-[92px] rounded-xl" />)}</div>
            <Skeleton className="h-72 rounded-xl" />
          </div>
        ) : error && !data ? (
          <LoadError error={error} onRetry={() => void reload(true)} />
        ) : data && data.scope.length === 0 ? (
          <p className="text-sm text-zinc-400">You&apos;re not rostered on any creator this month.</p>
        ) : data ? (
          <>
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <KpiTile label="Spenders" value={String(data.kpis.spenders)} meta={`${formatUsd(data.kpis.revenue)} gross in the period`} />
              <KpiTile label="Revenue per spender" basis="gross" value={data.kpis.revenuePerSpender === null ? '—' : formatUsd(data.kpis.revenuePerSpender)} />
              <KpiTile
                label="Whale share"
                basis="gross"
                value={formatShare(data.kpis.whaleShare)}
                meta={data.kpis.whaleShare === null ? undefined : `top 10% of spenders = ${formatShare(data.kpis.whaleShare)} of revenue`}
              />
              <KpiTile
                label="Trial → paying"
                value={formatShare(data.kpis.trialConversion)}
                meta={`of ${pluralise(data.kpis.trialFans, 'trial fan')}`}
              />
            </div>

            {/* ── Worth a message (focal) ── */}
            <section className={cn('rounded-xl p-5', SURFACE)} aria-labelledby="at-risk">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 id="at-risk" className="flex items-center gap-2 text-sm font-semibold">
                  Worth a message
                  {data.atRisk.length > 0 && (
                    <span className="rounded-full border border-orange-500/30 bg-orange-500/10 px-1.5 py-px text-[11px] font-medium tabular-nums text-orange-400">
                      {data.atRisk.length}
                    </span>
                  )}
                </h2>
                <p className="text-[11px] text-zinc-400">
                  Spent in the last {data.atRiskRule.windowDays} days, nothing in the last {data.atRiskRule.quietDays}. Biggest spenders first.
                </p>
              </div>
              {data.atRisk.length === 0 ? (
                <p className="mt-3 text-sm text-zinc-400">No spender has gone quiet.</p>
              ) : (
                <FanList fans={data.atRisk} onOpen={setOpenFan} mode="at-risk" />
              )}
            </section>

            {/* ── Top spenders ── */}
            <section className={cn('rounded-xl p-5', SURFACE)} aria-labelledby="top-spenders">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 id="top-spenders" className="text-sm font-semibold">Top spenders <span className="font-normal text-zinc-400">· gross</span></h2>
                <div className="flex items-center gap-3">
                  <span className="flex items-center gap-3 text-xs text-zinc-300">
                    <span className="inline-flex items-center gap-1.5"><LegendSwatch color={SALE_KIND_COLORS.tip} /> Tips</span>
                    <span className="inline-flex items-center gap-1.5"><LegendSwatch color={SALE_KIND_COLORS.ppv} /> PPV</span>
                  </span>
                  <ToggleGroup type="single" variant="outline" size="sm" value={lifetimeTop ? 'lifetime' : 'period'} onValueChange={v => v && setLifetimeTop(v === 'lifetime')} aria-label="Top spenders over">
                    <ToggleGroupItem value="period" className={SEGMENT}>Period</ToggleGroupItem>
                    <ToggleGroupItem value="lifetime" className={SEGMENT}>Lifetime</ToggleGroupItem>
                  </ToggleGroup>
                </div>
              </div>
              {data.topSpenders.length === 0 ? (
                <p className="mt-3 text-sm text-zinc-400">No purchases in this period.</p>
              ) : (
                <FanList
                  fans={lifetimeTop ? [...data.topSpenders].sort((a, b) => b.lifetimeSpend - a.lifetimeSpend) : data.topSpenders}
                  onOpen={setOpenFan}
                  mode={lifetimeTop ? 'lifetime' : 'period'}
                />
              )}
            </section>

            <div className="grid gap-4 lg:grid-cols-2">
              {/* ── Distribution ── */}
              <section className={cn('rounded-xl p-5', SURFACE)} aria-labelledby="distribution">
                <h2 id="distribution" className="text-sm font-semibold">Spend distribution</h2>
                <p className="mt-0.5 text-[11px] text-zinc-400">Spenders by what they spent (gross) in the period.</p>
                <ChartContainer config={distributionConfig} className="mt-3 h-[180px] w-full">
                  <BarChart data={data.distribution} margin={{ left: 4, right: 8, top: 8 }}>
                    <CartesianGrid vertical={false} strokeOpacity={0.15} />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} />
                    <YAxis tickLine={false} axisLine={false} width={32} allowDecimals={false} />
                    <ChartTooltip content={<ChartTooltipContent formatter={(v, _n, item) => [` ${v} spenders · ${formatUsd((item.payload as { revenue: number }).revenue)}`, '']} />} />
                    <Bar dataKey="fans" fill="var(--color-fans)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ChartContainer>
                <ul className="sr-only">
                  {data.distribution.map(b => <li key={b.label}>{b.label}: {b.fans} spenders, {formatUsd(b.revenue)}</li>)}
                </ul>
              </section>

              {/* ── Subscribers ── */}
              <section className={cn('rounded-xl p-5', SURFACE)} aria-labelledby="subs">
                <h2 id="subs" className="text-sm font-semibold">New subscribers in the period</h2>
                <dl className="mt-3 grid grid-cols-3 gap-4">
                  <div><dt className="text-xs text-zinc-400">New</dt><dd className="text-2xl font-semibold tabular-nums">{data.subscribers.new}</dd></div>
                  <div><dt className="text-xs text-zinc-400">Returning</dt><dd className="text-2xl font-semibold tabular-nums">{data.subscribers.returning}</dd></div>
                  <div><dt className="text-xs text-zinc-400">Free trial</dt><dd className="text-2xl font-semibold tabular-nums">{data.subscribers.trial}</dd></div>
                </dl>
                <p className="mt-2 text-[11px] text-zinc-400">From BuddyX subscriber events, which begin 25 Sep 2026.</p>
              </section>
            </div>

            {/* ── Acquisition (admin) ── */}
            {data.acquisition && (
              <section className={cn('rounded-xl p-5', SURFACE)} aria-labelledby="acquisition">
                <h2 id="acquisition" className="text-sm font-semibold">Where good fans come from</h2>
                <p className="mt-0.5 text-[11px] text-zinc-400">Tracking and free-trial links. ROI is (revenue − cost) ÷ cost; a free link shows “—”. Link revenue is as BuddyX reports it — its API does not say whether that is gross or net.</p>
                {data.acquisition.length === 0 ? (
                  <p className="mt-3 text-sm text-zinc-400">No links synced yet.</p>
                ) : (
                  <div tabIndex={0} role="region" aria-label="Acquisition links, scrollable" className="mt-3 overflow-x-auto rounded-lg border border-white/[0.07] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/50">
                    <table className="w-full min-w-[760px] text-sm">
                      <thead>
                        <tr className="border-b border-white/[0.07] text-[11px] uppercase tracking-wide text-zinc-400">
                          {['Link', 'Creator', 'Fans', 'Revenue (as reported)', 'Per fan', 'Cost', 'ROI'].map((h, i) => (
                            <th key={h} scope="col" className={cn('px-3 py-2.5 font-semibold', i < 2 ? 'text-left' : 'text-right')}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/[0.045]">
                        {data.acquisition.slice(0, 50).map(l => (
                          <tr key={`${l.creatorId}-${l.linkId}`}>
                            <td className="max-w-[16rem] truncate px-3 py-2">
                              {l.name ?? l.linkId}
                              <span className="ml-1.5 text-[11px] text-zinc-400">{l.kind === 'free-trial' ? 'free trial' : 'tracking'}</span>
                            </td>
                            <td className="px-3 py-2">{l.creatorId ? <CreatorChip creatorId={l.creatorId} size="xs" /> : '—'}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{l.fans}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{formatUsd(l.revenue)}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{l.revenuePerFan === null ? '—' : formatUsd(l.revenuePerFan)}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{l.cost > 0 ? formatUsd(l.cost) : '—'}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{l.roi === null ? '—' : `${Math.round(l.roi * 100)}%`}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            )}
          </>
        ) : null}
      </div>

      <FanDrawer
        creatorId={openFan?.creatorId ?? null}
        fanId={openFan?.fanId ?? null}
        timezone={timezone}
        onOpenChange={open => !open && setOpenFan(null)}
      />
    </AppLayout>
  );
}


function FanList({
  fans,
  onOpen,
  mode,
}: {
  fans: FanSummary[];
  onOpen: (fan: { creatorId: string; fanId: string }) => void;
  mode: 'at-risk' | 'period' | 'lifetime';
}) {
  return (
    <ul className="mt-3 divide-y divide-white/[0.07]">
      {fans.slice(0, 25).map(fan => {
        const tips = mode === 'period' ? fan.periodTips : fan.lifetimeTips;
        const ppv = mode === 'period' ? fan.periodPpv : fan.lifetimePpv;
        const total = Math.max(tips + ppv, 0.01);
        return (
          <li key={`${fan.creatorId}-${fan.fanId}`} className="relative">
            <button
              type="button"
              onClick={() => onOpen({ creatorId: fan.creatorId, fanId: fan.fanId })}
              className="absolute inset-0 rounded-md hover:bg-white/[0.055] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/50"
              aria-label={`Open ${fan.name ?? `fan ${fan.fanId}`}`}
            />
            <div className="pointer-events-none relative flex items-center gap-3 px-2 py-2 text-sm">
              <span className="min-w-0 flex-1">
                {/* Only the id link is its own target; a name is part of the row's. */}
                <span className={cn('relative', !fan.name && 'pointer-events-auto')}><FanLabel name={fan.name} fanId={fan.fanId} /></span>
                <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-zinc-400">
                  <CreatorChip creatorId={fan.creatorId} size="xs" />
                  {mode === 'at-risk' && <>· last bought {daysAgo(fan.lastPurchaseAt)} · usually {fan.usual ? USUAL[fan.usual] : '—'}</>}
                </span>
              </span>
              {/* Tip-vs-PPV mix, with the split in the label. */}
              <span className="flex h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-white/[0.06]" role="img" aria-label={`${formatUsd(tips)} tips, ${formatUsd(ppv)} PPV`}>
                <span style={{ width: `${(Math.max(tips, 0) / total) * 100}%`, background: SALE_KIND_COLORS.tip }} />
                <span style={{ width: `${(Math.max(ppv, 0) / total) * 100}%`, background: SALE_KIND_COLORS.ppv }} />
              </span>
              <span className="w-24 shrink-0 text-right tabular-nums">
                {formatUsd(mode === 'period' ? fan.periodSpend : fan.lifetimeSpend)}
                <span className="block text-[11px] text-zinc-400">{mode === 'period' ? 'gross' : 'lifetime gross'}</span>
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
