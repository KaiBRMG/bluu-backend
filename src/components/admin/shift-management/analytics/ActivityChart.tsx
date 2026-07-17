'use client';

import { Bar, BarChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts';
import {
  ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig,
} from '@/components/ui/chart';
import type { DailyPoint, AnalyticsTotals } from '@/lib/utils/analyticsAggregate';
import { SEQUENTIAL_HUE, formatDateShort } from './analyticsTypes';
import { ChartCard } from './ChartCard';

const ACTIVITY_CAVEAT =
  'Activity measures keyboard/mouse input, not output — reading, calls and thinking register as inactive. ' +
  'It is also produced by two different methods per capture, so treat cross-person comparisons with care.';

const histogramConfig = {
  count: { label: 'Captures', color: SEQUENTIAL_HUE },
} satisfies ChartConfig;

const trendConfig = {
  activity: { label: 'Mean activity', color: SEQUENTIAL_HUE },
} satisfies ChartConfig;

/**
 * Two single-axis charts, deliberately NOT one dual-axis chart: a count of
 * captures and a percentage share no scale, and overlaying them on two y-axes
 * would invite false correlation.
 */
export function ActivityChart({
  totals, series,
}: {
  totals: AnalyticsTotals;
  series: DailyPoint[];
}) {
  const histogram = (totals.activityHistogram ?? []).map((count, i) => ({
    bucket: `${i * 10}–${i * 10 + 9}%`,
    count,
  }));
  const hasHistogram = histogram.some(h => h.count > 0);

  const trend = series
    .filter(p => p.activityMean !== null)
    .map(p => ({ date: p.date, activity: Math.round(p.activityMean!) }));

  return (
    <>
      <ChartCard
        title="Activity distribution"
        description="How many screenshot windows fell in each activity band."
        caveat={ACTIVITY_CAVEAT}
        empty={!hasHistogram}
        emptyMessage="No activity samples in this range."
      >
        <ChartContainer config={histogramConfig} className="h-[220px] w-full">
          <BarChart data={histogram} margin={{ left: 4, right: 8, top: 8 }}>
            <CartesianGrid vertical={false} strokeOpacity={0.15} />
            <XAxis dataKey="bucket" tickLine={false} axisLine={false} tickMargin={8} minTickGap={4} />
            <YAxis tickLine={false} axisLine={false} tickMargin={8} width={32} allowDecimals={false} />
            <ChartTooltip content={<ChartTooltipContent />} />
            <Bar dataKey="count" fill="var(--color-count)" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ChartContainer>
      </ChartCard>

      <ChartCard
        title="Activity over time"
        description="Mean activity per day, weighted by capture count."
        empty={trend.length === 0}
        emptyMessage="No activity samples in this range."
      >
        <ChartContainer config={trendConfig} className="h-[220px] w-full">
          <LineChart data={trend} margin={{ left: 4, right: 8, top: 8 }}>
            <CartesianGrid vertical={false} strokeOpacity={0.15} />
            <XAxis
              dataKey="date"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              minTickGap={24}
              tickFormatter={formatDateShort}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              width={38}
              domain={[0, 100]}
              tickFormatter={(v) => `${v}%`}
            />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  labelFormatter={(label) => formatDateShort(String(label))}
                  formatter={(value) => [` ${value}%`, 'Mean activity']}
                />
              }
            />
            <Line
              dataKey="activity"
              type="monotone"
              stroke="var(--color-activity)"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
            />
          </LineChart>
        </ChartContainer>
      </ChartCard>
    </>
  );
}
