'use client';

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import {
  ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig,
} from '@/components/ui/chart';
import { Progress } from '@/components/ui/progress';
import type { WellbeingSummary } from '@/lib/utils/analyticsAggregate';
import type { AnalyticsUserRow } from '@/hooks/useAnalyticsData';
import {
  SERIES_BREAK, formatDateShort, formatDuration, formatPercent, toHours,
} from './analyticsTypes';
import { ChartCard } from './ChartCard';

const config = {
  breakTaken: { label: 'Break taken', color: SERIES_BREAK },
} satisfies ChartConfig;

/**
 * Break utilisation and streaks. Framed as a wellbeing signal, not a ranking —
 * chronic under-breaking and long unbroken streaks are the things worth seeing.
 */
export function WellbeingCard({
  wellbeing, byUser,
}: {
  wellbeing: WellbeingSummary;
  byUser: AnalyticsUserRow[];
}) {
  const data = wellbeing.byDate.map(d => ({
    date: d.date,
    breakTaken: toHours(d.breakSeconds),
  }));
  const hasBreaks = data.some(d => d.breakTaken > 0);

  const utilisation = wellbeing.breakUtilisation ?? 0;
  const utilisationPct = Math.min(100, Math.round(utilisation * 100));

  // Surface the people the signal is actually about.
  const streakLeaders = [...byUser]
    .filter(u => u.maxConsecutiveDays > 0)
    .sort((a, b) => b.maxConsecutiveDays - a.maxConsecutiveDays)
    .slice(0, 5);
  const noBreakLeaders = [...byUser]
    .filter(u => u.noBreakDays > 0)
    .sort((a, b) => b.noBreakDays - a.noBreakDays)
    .slice(0, 5);

  return (
    <ChartCard
      title="Breaks & wellbeing"
      description={
        `${formatPercent(wellbeing.breakUtilisation)} of the earned break allowance was used. ` +
        `${wellbeing.noBreakDays} day${wellbeing.noBreakDays === 1 ? '' : 's'} of 4h+ with no break at all.`
      }
    >
      <div className="mb-4">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs" style={{ color: 'var(--foreground-muted)' }}>
            Break allowance used
          </span>
          <span className="text-xs tabular-nums" style={{ color: 'var(--foreground-muted)' }}>
            {formatDuration(wellbeing.byDate.reduce((s, d) => s + d.breakSeconds, 0))}
            {' of '}
            {formatDuration(wellbeing.breakAllowanceSeconds)}
          </span>
        </div>
        <Progress value={utilisationPct} className="h-2" />
      </div>

      {hasBreaks ? (
        <ChartContainer config={config} className="h-[180px] w-full">
          <BarChart data={data} margin={{ left: 4, right: 8, top: 8 }}>
            <CartesianGrid vertical={false} strokeOpacity={0.15} />
            <XAxis
              dataKey="date" tickLine={false} axisLine={false} tickMargin={8}
              minTickGap={24} tickFormatter={formatDateShort}
            />
            <YAxis
              tickLine={false} axisLine={false} tickMargin={8} width={38}
              tickFormatter={(v) => `${v}h`}
            />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  labelFormatter={(label) => formatDateShort(String(label))}
                  formatter={(value) => [` ${formatDuration(Number(value) * 3600)}`, 'Break taken']}
                />
              }
            />
            <Bar dataKey="breakTaken" fill="var(--color-breakTaken)" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ChartContainer>
      ) : (
        <div className="py-8 text-center text-sm" style={{ color: 'var(--foreground-muted)' }}>
          No breaks taken in this range.
        </div>
      )}

      {(streakLeaders.length > 0 || noBreakLeaders.length > 0) && (
        <div className="grid gap-4 mt-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
          {streakLeaders.length > 0 && (
            <div>
              <h4 className="text-xs mb-2" style={{ color: 'var(--foreground-muted)' }}>
                Longest streak (consecutive days worked)
              </h4>
              <ul className="space-y-1">
                {streakLeaders.map(u => (
                  <li key={u.userId} className="flex justify-between text-xs">
                    <span className="truncate pr-2">{u.displayName}</span>
                    <span className="tabular-nums shrink-0">{u.maxConsecutiveDays}d</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {noBreakLeaders.length > 0 && (
            <div>
              <h4 className="text-xs mb-2" style={{ color: 'var(--foreground-muted)' }}>
                Most days without a break
              </h4>
              <ul className="space-y-1">
                {noBreakLeaders.map(u => (
                  <li key={u.userId} className="flex justify-between text-xs">
                    <span className="truncate pr-2">{u.displayName}</span>
                    <span className="tabular-nums shrink-0">{u.noBreakDays}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </ChartCard>
  );
}
