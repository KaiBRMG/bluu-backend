"use client";

import { Card, CardHeader, CardContent, CardDescription, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Label as RechartsLabel, Pie, PieChart } from "recharts";
import { type CampaignEntry, type Creator, formatAmount } from "@/lib/campaignTracking";

// Snapped from the stock --chart-1..5 dark values, which fail the dataviz
// checks on this surface (chart-2/3 too light, chart-1 under 3:1 contrast).
// Same hues, lightness pulled into the dark band; validated CVD-safe.
const DONUT_COLORS = ["#4176f6", "#00a86f", "#cb7f00", "#a65af1", "#f63b5d"];

const RADIAN = Math.PI / 180;

// Whole-dollar display for the donut centre; rounds up so cents never show.
const formatAmountWhole = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Math.ceil(n));

// Renders a slice's label outside the segment, wrapping word-by-word onto
// extra lines so long names don't overflow the card.
function renderWrappedSliceLabel(props: unknown) {
  const { cx, cy, midAngle, outerRadius, payload, name } = props as {
    cx: number; cy: number; midAngle: number; outerRadius: number;
    payload?: { label?: string }; name?: string;
  };
  const cos = Math.cos(-midAngle * RADIAN);
  const sin = Math.sin(-midAngle * RADIAN);
  const rOut = outerRadius + 14;
  const x = cx + rOut * cos;
  const y = cy + rOut * sin;
  const raw = payload?.label ?? String(name);
  const lines = raw.includes("\n") ? raw.split("\n") : raw.split(" ");
  const lineHeight = 12;
  return (
    <text
      x={x}
      y={y - ((lines.length - 1) * lineHeight) / 2}
      textAnchor={cos > 0.1 ? "start" : cos < -0.1 ? "end" : "middle"}
      dominantBaseline="central"
      className="fill-muted-foreground text-xs"
    >
      {lines.map((line, i) => (
        <tspan key={i} x={x} dy={i === 0 ? 0 : lineHeight}>{line}</tspan>
      ))}
    </text>
  );
}

interface OutstandingPaymentsDonutProps {
  /** Entries to summarise. Only those still owed (amountPaid < totalAmount)
   *  and belonging to an active creator contribute. */
  entries: CampaignEntry[];
  creators: Creator[];
}

/**
 * Outstanding-payments donut: one slice per creator (top 4 + "Other"), whose
 * hover breaks the creator's outstanding total down by fan.
 */
export function OutstandingPaymentsDonut({ entries, creators }: OutstandingPaymentsDonutProps) {
  const activeCreatorIds = new Set(creators.map(c => c.creatorID));

  // Outstanding $ per creator, plus a per-fan breakdown, largest first.
  const outstandingAmounts = creators
    .map(c => {
      const byFan = new Map<string, number>();
      for (const e of entries) {
        if (e.creatorID !== c.creatorID || !activeCreatorIds.has(e.creatorID)) continue;
        const diff = e.totalAmount - e.amountPaid;
        if (diff > 0) byFan.set(e.fanName, (byFan.get(e.fanName) ?? 0) + diff);
      }
      return {
        name: c.stageName,
        amount: [...byFan.values()].reduce((sum, v) => sum + v, 0),
        byFan,
      };
    })
    .filter(d => d.amount > 0)
    .sort((a, b) => b.amount - a.amount);

  const sumFans = (ds: typeof outstandingAmounts) => {
    const merged = new Map<string, number>();
    for (const d of ds) for (const [fan, amt] of d.byFan) merged.set(fan, (merged.get(fan) ?? 0) + amt);
    return [...merged.entries()].filter(([, amt]) => amt > 0).sort((a, b) => b[1] - a[1]);
  };

  // Fold everything past the 4th creator into "Other" so the series count
  // never exceeds the 5 chart colors.
  const donutSlices = [
    ...outstandingAmounts.slice(0, 4).map((d, i) => ({
      slice: `creator${i}`, label: d.name, amount: d.amount, fans: sumFans([d]),
    })),
    ...(outstandingAmounts.length > 4
      ? [{
          slice: "other",
          label: outstandingAmounts.length === 5 ? outstandingAmounts[4].name : "Other",
          amount: outstandingAmounts.slice(4).reduce((sum, d) => sum + d.amount, 0),
          fans: sumFans(outstandingAmounts.slice(4)),
        }]
      : []),
  ];
  const donutConfig = {
    amount: { label: "Outstanding" },
    ...Object.fromEntries(donutSlices.map((s, i) => [s.slice, { label: s.label, color: DONUT_COLORS[i] }])),
  } satisfies ChartConfig;
  const donutData = donutSlices.map(s => ({ ...s, fill: `var(--color-${s.slice})` }));
  const outstanding = donutSlices.reduce((sum, s) => sum + s.amount, 0);

  return (
    <Card className="gap-3 py-4">
      <CardHeader className="px-4">
        <CardDescription>Outstanding Payments</CardDescription>
        {donutData.length === 0 && (
          <CardTitle className="text-2xl font-semibold tabular-nums">{formatAmount(0)}</CardTitle>
        )}
      </CardHeader>
      <CardContent className="flex-1 px-4 pb-0">
        {donutData.length > 0 ? (
          <ChartContainer
            config={donutConfig}
            className="mx-auto aspect-auto h-[160px] w-full [&_.recharts-surface]:overflow-visible"
          >
            <PieChart>
              <ChartTooltip
                cursor={false}
                content={
                  <ChartTooltipContent
                    hideLabel
                    formatter={(value, name, item) => {
                      const { fill, fans = [] } =
                        (item as { payload?: { fill?: string; fans?: [string, number][] } }).payload ?? {};
                      return (
                        <div className="flex w-full flex-col gap-1">
                          <div className="flex items-center gap-2">
                            <span className="size-2.5 shrink-0 rounded-[2px]" style={{ background: fill }} />
                            <span className="text-muted-foreground">
                              {donutConfig[name as keyof typeof donutConfig]?.label ?? name}
                            </span>
                            <span className="ml-auto font-mono font-medium tabular-nums text-foreground">
                              {formatAmountWhole(Number(value))}
                            </span>
                          </div>
                          {fans.map(([fan, amt]) => (
                            <div key={fan} className="flex items-center justify-between gap-4 pl-4 text-muted-foreground">
                              <span className="truncate">{fan}</span>
                              <span className="font-mono tabular-nums">{formatAmountWhole(amt)}</span>
                            </div>
                          ))}
                        </div>
                      );
                    }}
                  />
                }
              />
              <Pie
                data={donutData}
                dataKey="amount"
                nameKey="slice"
                innerRadius={48}
                outerRadius={62}
                strokeWidth={2}
                stroke="var(--card)"
                labelLine={false}
                label={renderWrappedSliceLabel}
              >
                <RechartsLabel
                  content={({ viewBox }) => {
                    if (viewBox && "cx" in viewBox && "cy" in viewBox) {
                      return (
                        <text
                          x={viewBox.cx}
                          y={viewBox.cy}
                          textAnchor="middle"
                          dominantBaseline="central"
                          className="fill-foreground text-base font-bold"
                        >
                          {formatAmountWhole(outstanding)}
                        </text>
                      );
                    }
                  }}
                />
              </Pie>
            </PieChart>
          </ChartContainer>
        ) : (
          <p className="text-sm text-muted-foreground">Nothing outstanding.</p>
        )}
      </CardContent>
    </Card>
  );
}
