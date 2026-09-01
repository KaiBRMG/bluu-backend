'use client';

import { memo, useMemo } from 'react';
import { CartesianGrid, Line, LineChart, ReferenceLine, XAxis, YAxis } from 'recharts';
import { ChartContainer, ChartTooltip, type ChartConfig } from '@/components/ui/chart';
import {
  MODE_LABEL,
  formatCompact,
  formatCount,
  toChartRows,
  type DayMap,
  type GrowthMode,
} from '@/lib/growth/metrics';
import type { GrowthAccount } from '@/types/firestore';

/**
 * The growth chart: a greyscale field with one highlighted trace.
 *
 * Twelve coloured lines would be a rainbow on a greyscale console — the exact
 * thing DESIGN.md's "don't map an open-ended label onto N hues" Don't forbids —
 * and it would stop working entirely as the tracked list grows, which it is
 * expected to. So every account draws as a faint white trace (the field, showing
 * the shape of the whole roster at once) and the account under the cursor —
 * hovered in the chart or in the leaderboard below — lifts to Action Blue. Hue
 * marks the current selection and nothing else: the One Voice Rule, applied to a
 * chart.
 *
 * The consequence worth knowing: reading *which* line is which is done by
 * pointing, not by decoding a legend. That is a better trade at twelve series
 * and a far better one at thirty.
 */

/**
 * These carry the page's primary information, so they are held above the 3:1
 * non-text contrast floor (WCAG 1.4.11) rather than tuned by eye: 0.34 white on
 * the card ground measures ~3.1:1, where the 0.20 this shipped with was ~2.1:1.
 * The dimmed step is a de-emphasis, not a disappearance — 0.16 still resolves as
 * a line, which is what makes the field read as a field.
 */
const FIELD = 'rgba(255,255,255,0.34)';
const FIELD_DIMMED = 'rgba(255,255,255,0.16)';
const HIGHLIGHT = '#3b82f6';

interface GrowthChartProps {
  accounts: GrowthAccount[];
  seriesById: Map<string, DayMap>;
  from: string | null;
  mode: GrowthMode;
  /** The account to lift out of the field, if any. */
  highlightId: string | null;
  onHighlight: (id: string | null) => void;
}

export const GrowthChart = memo(function GrowthChart({
  accounts,
  seriesById,
  from,
  mode,
  highlightId,
  onHighlight,
}: GrowthChartProps) {
  const rows = useMemo(() => {
    const included = new Map<string, DayMap>();
    for (const a of accounts) {
      const days = seriesById.get(a.id);
      if (days) included.set(a.id, days);
    }
    return toChartRows(included, from, mode);
  }, [accounts, seriesById, from, mode]);

  // ChartContainer needs a config to render, but every series shares one ink —
  // the per-account colour is decided per-Line below, not by the config.
  const config = useMemo<ChartConfig>(
    () => Object.fromEntries(accounts.map((a) => [a.id, { label: a.displayName, color: FIELD }])),
    [accounts],
  );

  if (rows.length === 0) {
    return (
      <div className="flex h-[320px] items-center justify-center">
        <p className="text-sm text-zinc-400">No readings in this range yet.</p>
      </div>
    );
  }

  const suffix = mode === 'indexed' ? '%' : '';

  return (
    <>
      {/* The field resolves by pointing, which a keyboard or a screen reader
          cannot do. The leaderboard below already states every one of these
          figures as text — this is what says so. */}
      <p className="sr-only">
        {MODE_LABEL[mode]} for {accounts.length} account{accounts.length === 1 ? '' : 's'}.
        The same figures are listed as text in the account table below this chart.
      </p>
      <ChartContainer config={config} className="h-[320px] w-full">
        <LineChart
          accessibilityLayer
          data={rows}
          margin={{ left: 4, right: 12, top: 8, bottom: 4 }}
          onMouseLeave={() => onHighlight(null)}
        >
          <CartesianGrid vertical={false} strokeOpacity={0.12} />
          <XAxis
            dataKey="date"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            minTickGap={32}
            tickFormatter={formatAxisDate}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            width={mode === 'absolute' ? 48 : 44}
            tickFormatter={(v: number) => `${formatCompact(v)}${suffix}`}
          />
          {/* Zero is the baseline every account is measured from in the relative
              modes, so it earns a line. In absolute mode zero is off-scale and
              meaningless, so it is not drawn. */}
          {mode !== 'absolute' && (
            <ReferenceLine y={0} stroke="rgba(255,255,255,0.28)" strokeDasharray="3 3" />
          )}
          <ChartTooltip
            cursor={{ stroke: 'rgba(255,255,255,0.2)', strokeWidth: 1 }}
            content={<GrowthTooltip accounts={accounts} mode={mode} highlightId={highlightId} />}
          />
          {accounts.map((account) => {
            const isHighlighted = account.id === highlightId;
            const dimmed = highlightId !== null && !isHighlighted;
            return (
              <Line
                key={account.id}
                dataKey={account.id}
                name={account.displayName}
                type="monotone"
                // A gap is a day nobody recorded, not a fall to zero. Bridging it
                // keeps the trend honest; dropping to the axis would invent a
                // crash every weekend in the imported months.
                connectNulls
                stroke={isHighlighted ? HIGHLIGHT : dimmed ? FIELD_DIMMED : FIELD}
                strokeWidth={isHighlighted ? 2.25 : 1.5}
                dot={false}
                activeDot={isHighlighted ? { r: 3, strokeWidth: 0, fill: HIGHLIGHT } : false}
                isAnimationActive={false}
                onMouseEnter={() => onHighlight(account.id)}
                // Colour only. Transitioning `stroke-width` re-rasterises every
                // path in the field on each hover — the same defect DESIGN.md
                // flags for `filter` on the chat rows. The hue is what reads.
                style={{ transition: 'stroke 120ms ease-out' }}
              />
            );
          })}
        </LineChart>
      </ChartContainer>
    </>
  );
});

/** Day keys are UTC, so they must be rendered in UTC or the axis shifts a day. */
function formatAxisDate(value: string): string {
  return new Date(`${value}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

/**
 * The tooltip carries what the greyscale field cannot: names and numbers.
 *
 * It is ranked by value and capped, because twelve rows under the cursor is a
 * panel, not a tooltip. When an account is highlighted it is pinned to the top
 * regardless of rank — that is the one the reader is actually asking about.
 */
function GrowthTooltip({
  accounts,
  mode,
  highlightId,
  active,
  payload,
  label,
}: {
  accounts: GrowthAccount[];
  mode: GrowthMode;
  highlightId: string | null;
  active?: boolean;
  payload?: Array<{ dataKey?: string | number; value?: number }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;

  const byId = new Map(accounts.map((a) => [a.id, a]));
  const entries = payload
    .map((p) => ({ id: String(p.dataKey), value: Number(p.value) }))
    .filter((e) => byId.has(e.id) && Number.isFinite(e.value))
    .sort((a, b) => {
      if (a.id === highlightId) return -1;
      if (b.id === highlightId) return 1;
      return b.value - a.value;
    });

  const MAX_ROWS = 6;
  const shown = entries.slice(0, MAX_ROWS);
  const hidden = entries.length - shown.length;

  const render = (value: number) =>
    mode === 'indexed'
      ? `${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(2)}%`
      : mode === 'net'
        ? `${value > 0 ? '+' : value < 0 ? '−' : ''}${formatCount(Math.abs(value))}`
        : formatCount(value);

  return (
    <div className="min-w-[12rem] rounded-lg border border-white/[0.07] bg-[#171717] px-2.5 py-2">
      <p className="mb-1.5 text-[11px] text-zinc-400 tabular-nums">
        {label && new Date(`${label}T00:00:00Z`).toLocaleDateString('en-GB', {
          day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
        })}
      </p>
      <ul className="space-y-1">
        {shown.map((entry) => {
          const account = byId.get(entry.id)!;
          const isHighlighted = entry.id === highlightId;
          return (
            <li key={entry.id} className="flex items-baseline justify-between gap-4 text-xs">
              <span className={isHighlighted ? 'font-semibold text-white' : 'text-zinc-300'}>
                {account.displayName}
              </span>
              <span className={`tabular-nums ${isHighlighted ? 'text-white' : 'text-zinc-400'}`}>
                {render(entry.value)}
              </span>
            </li>
          );
        })}
      </ul>
      {hidden > 0 && (
        <p className="mt-1.5 text-[11px] text-zinc-400">
          +{hidden} more · hover a row below to follow one
        </p>
      )}
      <p className="sr-only">{MODE_LABEL[mode]}</p>
    </div>
  );
}
