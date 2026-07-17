'use client';

import { Bar, BarChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts';
import {
  ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig,
} from '@/components/ui/chart';
import type { FocusSummary } from '@/lib/utils/analyticsAggregate';
import {
  SERIES_WORKING, SERIES_IDLE, formatDateShort, formatDuration, formatPercent, toHours,
} from './analyticsTypes';
import { ChartCard } from './ChartCard';

const focusConfig = {
  focus: { label: 'Focus time', color: SERIES_WORKING },
} satisfies ChartConfig;

const fragConfig = {
  fragmentation: { label: 'Interruptions / working hour', color: SERIES_IDLE },
} satisfies ChartConfig;

/**
 * Focus time and fragmentation as two single-axis charts.
 *
 * Hours and a per-hour rate share no scale — putting them on one chart with two
 * y-axes would let any pair of lines be made to look correlated. Two charts, one
 * axis each.
 */
export function FocusCard({ focus }: { focus: FocusSummary }) {
  const focusData = focus.byDate.map(d => ({
    date: d.date,
    focus: toHours(d.focusSecondsInBlocks),
  }));
  const fragData = focus.byDate
    .filter(d => d.fragmentationRatio !== null)
    .map(d => ({
      date: d.date,
      fragmentation: Math.round((d.fragmentationRatio ?? 0) * 10) / 10,
    }));

  const hasFocus = focusData.some(d => d.focus > 0);

  return (
    <>
      <ChartCard
        title="Focus time"
        description={
          `Uninterrupted working blocks of 25 minutes or more. ` +
          `Longest ${formatDuration(focus.longestFocusBlockSeconds)} · ` +
          `${formatPercent(focus.focusRatio)} of working time is in focus blocks.`
        }
        empty={!hasFocus}
        emptyMessage="No focus blocks in this range."
      >
        <ChartContainer config={focusConfig} className="h-[220px] w-full">
          <BarChart data={focusData} margin={{ left: 4, right: 8, top: 8 }}>
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
                  formatter={(value) => [` ${formatDuration(Number(value) * 3600)}`, 'Focus time']}
                />
              }
            />
            <Bar dataKey="focus" fill="var(--color-focus)" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ChartContainer>
      </ChartCard>

      <ChartCard
        title="Fragmentation"
        description={
          `Interruptions (idle, break or pause) per working hour. ` +
          `Overall ${focus.fragmentationRatio !== null ? focus.fragmentationRatio.toFixed(1) : '—'} per hour ` +
          `across ${focus.interruptionCount} interruption${focus.interruptionCount === 1 ? '' : 's'}.`
        }
        caveat="Machine-sleep gaps are excluded — a laptop suspending is not an interruption."
        empty={fragData.length === 0}
        emptyMessage="No working time in this range."
      >
        <ChartContainer config={fragConfig} className="h-[220px] w-full">
          <LineChart data={fragData} margin={{ left: 4, right: 8, top: 8 }}>
            <CartesianGrid vertical={false} strokeOpacity={0.15} />
            <XAxis
              dataKey="date" tickLine={false} axisLine={false} tickMargin={8}
              minTickGap={24} tickFormatter={formatDateShort}
            />
            <YAxis tickLine={false} axisLine={false} tickMargin={8} width={32} />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  labelFormatter={(label) => formatDateShort(String(label))}
                  formatter={(value) => [` ${value} / hour`, 'Interruptions']}
                />
              }
            />
            <Line
              dataKey="fragmentation" type="monotone" stroke="var(--color-fragmentation)"
              strokeWidth={2} dot={false} activeDot={{ r: 4 }}
            />
          </LineChart>
        </ChartContainer>
      </ChartCard>
    </>
  );
}
