'use client';

import { useMemo } from 'react';
import { ExternalLinkIcon } from 'lucide-react';
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle,
} from '@/components/ui/sheet';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';
import {
  RANGE_LABEL,
  dataHealth,
  deltaFor,
  formatCompact,
  formatCount,
  pointsFor,
  type DayMap,
  type GrowthRange,
} from '@/lib/growth/metrics';
import { DeltaValue, PlatformChip } from './growthUi';
import type { GrowthAccount, GrowthSnapshot } from '@/types/firestore';

const config = { followers: { label: 'Followers', color: '#3b82f6' } } satisfies ChartConfig;

/**
 * One account, in full. This is where the free extras earn their place: the
 * headline everywhere else is followers, because that is the only metric both
 * scrapers produce and the only one the imported history has — but each actor
 * hands back a few more fields inside the same billed result, and this is the
 * surface with room to show them.
 *
 * It also carries the data-health line. Coverage matters here and nowhere else:
 * the imported months skip most weekends, so "44 readings over 62 days" is
 * context a reader needs before drawing conclusions from the shape of the line.
 */
export function AccountDetailSheet({
  account,
  days,
  from,
  range,
  onOpenChange,
}: {
  account: GrowthAccount | null;
  days: DayMap;
  from: string | null;
  range: GrowthRange;
  onOpenChange: (open: boolean) => void;
}) {
  const view = useMemo(() => {
    if (!account) return null;
    return {
      delta: deltaFor(days, from),
      health: dataHealth(days, from),
      rows: pointsFor(days, from, 'absolute').map((p) => ({ date: p.date, followers: p.value })),
      latest: account.latest,
    };
  }, [account, days, from]);

  return (
    <Sheet open={account !== null} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-lg">
        {account && view && (
          <>
            <SheetHeader className="gap-2">
              <div className="flex items-center gap-2">
                <PlatformChip platform={account.platform} />
                {!account.isActive && (
                  <span className="rounded-md bg-white/[0.08] px-1.5 py-0.5 text-[11px] font-medium text-zinc-300">
                    Not tracked
                  </span>
                )}
              </div>
              <SheetTitle className="text-lg">{account.displayName}</SheetTitle>
              <SheetDescription asChild>
                <a
                  href={account.profileUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex w-fit items-center gap-1 text-sm text-zinc-400 underline-offset-2 transition-colors hover:text-white hover:underline"
                >
                  @{account.handle}
                  <ExternalLinkIcon className="size-3" aria-hidden />
                </a>
              </SheetDescription>
            </SheetHeader>

            <div className="space-y-6 px-4 pb-6">
              <div className="grid grid-cols-2 gap-4">
                <Stat label="Followers">
                  {view.delta.last === null ? '—' : formatCount(view.delta.last)}
                </Stat>
                <Stat label={`Change · ${RANGE_LABEL[range].toLowerCase()}`}>
                  <DeltaValue delta={view.delta} className="text-2xl font-semibold" />
                </Stat>
              </div>

              {view.rows.length >= 2 ? (
                <ChartContainer config={config} className="h-[200px] w-full">
                  <AreaChart data={view.rows} margin={{ left: 4, right: 8, top: 8 }}>
                    <CartesianGrid vertical={false} strokeOpacity={0.12} />
                    <XAxis
                      dataKey="date" tickLine={false} axisLine={false} tickMargin={8} minTickGap={32}
                      tickFormatter={(v: string) => new Date(`${v}T00:00:00Z`).toLocaleDateString('en-GB', {
                        day: 'numeric', month: 'short', timeZone: 'UTC',
                      })}
                    />
                    {/* Followers rarely start near zero, so the axis is scaled to
                        the data. A zero-based axis would flatten a 3% month into
                        a straight line and hide the only thing this chart shows. */}
                    <YAxis
                      tickLine={false} axisLine={false} tickMargin={8} width={48}
                      domain={['dataMin - 200', 'dataMax + 200']}
                      tickFormatter={(v: number) => formatCompact(v)}
                    />
                    <ChartTooltip
                      content={<ChartTooltipContent
                        labelFormatter={(l) => new Date(`${String(l)}T00:00:00Z`).toLocaleDateString('en-GB', {
                          day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
                        })}
                        formatter={(value) => [` ${formatCount(Number(value))}`, 'Followers']}
                      />}
                    />
                    <Area
                      dataKey="followers" type="monotone" connectNulls
                      stroke="var(--color-followers)" fill="var(--color-followers)"
                      fillOpacity={0.15} strokeWidth={2} isAnimationActive={false}
                    />
                  </AreaChart>
                </ChartContainer>
              ) : (
                <p className="text-sm text-zinc-400">
                  {view.rows.length === 1
                    ? 'One reading so far. The next comes with tonight’s scrape.'
                    : 'No readings in this range.'}
                </p>
              )}

              <ExtraMetrics platform={account.platform} snapshot={view.latest} />

              <section>
                <h3 className="mb-2 text-sm font-semibold">Data coverage</h3>
                <p className="text-sm text-zinc-400">
                  {view.health.captured === 0 ? (
                    'Nothing recorded in this range.'
                  ) : (
                    <>
                      <span className="tabular-nums text-zinc-300">{view.health.captured}</span>
                      {' reading'}{view.health.captured === 1 ? '' : 's'}
                      {view.health.missed > 0 && (
                        <>
                          {', '}
                          <span className="tabular-nums text-zinc-300">{view.health.missed}</span>
                          {' day'}{view.health.missed === 1 ? '' : 's'}{' missed'}
                        </>
                      )}
                      {view.health.firstDay && (
                        <> · from {formatDay(view.health.firstDay)} to {formatDay(view.health.lastDay!)}</>
                      )}
                    </>
                  )}
                </p>
                {account.lastScrapeStatus === 'failed' && account.lastScrapeError && (
                  <p className="mt-2 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-400">
                    {account.lastScrapeError}
                  </p>
                )}
              </section>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-xs text-zinc-400">{label}</p>
      <p className="text-2xl font-semibold tabular-nums">{children}</p>
    </div>
  );
}

/**
 * The fields each actor returns alongside followers at no extra cost. They are
 * shown as a latest value only, not charted: they are not in the imported
 * history, so a chart of them would start abruptly at whenever automation began
 * and imply the metric did not exist before.
 */
function ExtraMetrics({
  platform,
  snapshot,
}: {
  platform: GrowthAccount['platform'];
  snapshot: (GrowthSnapshot & { date: string }) | null;
}) {
  if (!snapshot) return null;

  const fields: Array<[string, number | undefined]> = platform === 'facebook'
    ? [['Page likes', snapshot.likes], ['Rating', snapshot.rating], ['Reviews', snapshot.ratingCount]]
    : [['Following', snapshot.following], ['Posts', snapshot.posts], ['Media', snapshot.media]];

  const present = fields.filter((f): f is [string, number] => f[1] !== undefined);
  if (present.length === 0) return null;

  return (
    <section>
      <h3 className="mb-2 text-sm font-semibold">Also captured</h3>
      <dl className="grid grid-cols-3 gap-3">
        {present.map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs text-zinc-400">{label}</dt>
            <dd className="text-sm tabular-nums text-zinc-300">
              {label === 'Rating' ? value.toFixed(1) : formatCount(value)}
            </dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-[11px] text-zinc-400">
        As of {formatDay(snapshot.date)} · not part of the imported history, so not charted
      </p>
    </section>
  );
}

function formatDay(dayKey: string): string {
  return new Date(`${dayKey}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  });
}
