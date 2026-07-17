'use client';

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import {
  ChartContainer, ChartTooltip, ChartTooltipContent, ChartLegend, ChartLegendContent,
  type ChartConfig,
} from '@/components/ui/chart';
import type { AdherenceSummary } from '@/lib/utils/analyticsAggregate';
import {
  STATUS_ON_TIME, STATUS_LATE, STATUS_ABSENT,
  formatDateShort, formatDuration, formatPercent,
} from './analyticsTypes';
import { ChartCard } from './ChartCard';

// Status colours, never reused as series colours. They always ship with a
// legend and a label — status must never be carried by colour alone.
const config = {
  onTime: { label: 'On time', color: STATUS_ON_TIME },
  late:   { label: 'Late',    color: STATUS_LATE },
  absent: { label: 'Absent',  color: STATUS_ABSENT },
} satisfies ChartConfig;

export function AdherenceCard({ adherence }: { adherence: AdherenceSummary }) {
  const data = adherence.byDate.map(d => ({
    date: d.date, onTime: d.onTime, late: d.late, absent: d.absent,
  }));
  const total = adherence.onTime + adherence.late + adherence.absent;

  return (
    <ChartCard
      title="Schedule adherence"
      description={
        `${adherence.onTime} on time · ${adherence.late} late · ${adherence.absent} absent ` +
        `— ${formatPercent(adherence.punctuality)} punctual. ` +
        `${formatDuration(adherence.unrosteredOvertimeSeconds)} worked outside rostered shifts.`
      }
      empty={total === 0}
      emptyMessage="No shifts rostered in this range."
    >
      <ChartContainer config={config} className="h-[240px] w-full">
        <BarChart data={data} margin={{ left: 4, right: 8, top: 8 }}>
          <CartesianGrid vertical={false} strokeOpacity={0.15} />
          <XAxis
            dataKey="date"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            minTickGap={24}
            tickFormatter={formatDateShort}
          />
          <YAxis tickLine={false} axisLine={false} tickMargin={8} width={32} allowDecimals={false} />
          <ChartTooltip
            content={
              <ChartTooltipContent labelFormatter={(label) => formatDateShort(String(label))} />
            }
          />
          <ChartLegend content={<ChartLegendContent />} />
          <Bar dataKey="onTime" stackId="a" fill="var(--color-onTime)" radius={[0, 0, 0, 0]} />
          <Bar dataKey="late"   stackId="a" fill="var(--color-late)"   radius={[0, 0, 0, 0]} />
          <Bar dataKey="absent" stackId="a" fill="var(--color-absent)" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ChartContainer>
    </ChartCard>
  );
}
