'use client';

import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import {
  ChartContainer, ChartTooltip, ChartTooltipContent, ChartLegend, ChartLegendContent,
  type ChartConfig,
} from '@/components/ui/chart';
import type { DailyPoint } from '@/lib/utils/analyticsAggregate';
import {
  SERIES_WORKING, SERIES_BREAK, SERIES_IDLE, SERIES_PAUSE,
  formatDateShort, formatDuration, toHours,
} from './analyticsTypes';
import { ChartCard } from './ChartCard';

const config = {
  working: { label: 'Working', color: SERIES_WORKING },
  break:   { label: 'Break',   color: SERIES_BREAK },
  idle:    { label: 'Idle',    color: SERIES_IDLE },
  // "Paused / asleep": the tracker injects a synthetic pause to exclude a span
  // the machine was suspended, so this band is not purely user-initiated.
  pause:   { label: 'Paused / asleep', color: SERIES_PAUSE },
} satisfies ChartConfig;

export function WorkTrendChart({ series }: { series: DailyPoint[] }) {
  const data = series.map(p => ({
    date: p.date,
    working: toHours(p.workingSeconds),
    break:   toHours(p.breakSeconds),
    idle:    toHours(p.idleSeconds),
    pause:   toHours(p.pauseSeconds),
  }));

  return (
    <ChartCard
      title="Time breakdown"
      description="Hours per day by tracked state. Total worked = working + break."
      empty={data.length === 0}
    >
      <ChartContainer config={config} className="h-[280px] w-full">
        <AreaChart data={data} margin={{ left: 4, right: 8, top: 8 }}>
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
            tickFormatter={(v) => `${v}h`}
          />
          <ChartTooltip
            content={
              <ChartTooltipContent
                labelFormatter={(label) => formatDateShort(String(label))}
                formatter={(value, name) => [
                  ` ${formatDuration(Number(value) * 3600)}`,
                  config[name as keyof typeof config]?.label ?? name,
                ]}
              />
            }
          />
          <ChartLegend content={<ChartLegendContent />} />
          {(['working', 'break', 'idle', 'pause'] as const).map(key => (
            <Area
              key={key}
              dataKey={key}
              type="monotone"
              stackId="1"
              stroke={`var(--color-${key})`}
              fill={`var(--color-${key})`}
              fillOpacity={0.5}
              strokeWidth={2}
            />
          ))}
        </AreaChart>
      </ChartContainer>
    </ChartCard>
  );
}
