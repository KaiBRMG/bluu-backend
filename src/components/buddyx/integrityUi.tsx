'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CartesianGrid, ReferenceLine, Scatter, ScatterChart, XAxis, YAxis, ZAxis } from 'recharts';
import { ChartContainer, ChartTooltip, type ChartConfig } from '@/components/ui/chart';
import { cn } from '@/lib/utils';
import { STATUS_HEX } from '@/lib/campaignTracking';
import { formatDayLabelWithWeekday } from '@/lib/salary/salaryDate';
import { formatDuration, formatShare } from '@/lib/buddyx/analyticsFormat';
import { COVERAGE_FLAG_RATIO, HOUR_MS } from '@/lib/buddyx/coverage';
import { SEQUENTIAL_COLOR } from '@/lib/buddyx/chartColors';
import type { ChatterLeaderboardRow, CoverageFigures, IntegrityFlag, IntegritySummary } from '@/lib/buddyx/analyticsTypes';

/**
 * The integrity layer of Chatter Analytics — admin views only, display only.
 * Every sentence here describes what was measured, never a conclusion about
 * the person: a flag is a lead to look at, and the report shows the minutes
 * behind it (documentation/time-tracking.md §4b).
 */

const MINUTE = 60_000;

/** "Mon 6 Oct, Wed 8 Oct" — at most three, then "+N more". */
function dayList(days: string[]): string {
  if (days.length === 0) return '';
  const shown = days.slice(0, 3).map(formatDayLabelWithWeekday).join(', ');
  return days.length > 3 ? `${shown} +${days.length - 3} more` : shown;
}

/** One flag as a sentence. `withName` off for a single agent's report, where the name is the page. */
export function flagSentence(flag: IntegrityFlag, withName: boolean): string {
  const minutes = formatDuration((flag.minutes ?? 0) * MINUTE);
  const say = (named: string, bare: string) => (withName ? `${flag.name} ${named}` : bare);
  switch (flag.kind) {
    case 'never-online': {
      const shifts = `${flag.shifts} ${flag.shifts === 1 ? 'shift' : 'shifts'}`;
      return say(`was rostered on ${shifts} and never online in BuddyX`, `Rostered on ${shifts} and never online in BuddyX`);
    }
    case 'low-coverage':
      return say(
        `was online in BuddyX for ${formatShare(flag.ratio)} of clocked working time`,
        `Online in BuddyX for ${formatShare(flag.ratio)} of clocked working time`,
      );
    case 'regular-input':
      return say(`typed on a machine-regular beat for ${minutes}`, `Typed on a machine-regular beat for ${minutes}`);
    case 'modifier-only':
      return say(`pressed only modifier or filler keys for ${minutes}`, `Pressed only modifier or filler keys for ${minutes}`);
    case 'static-screen':
      return withName ? `${flag.name}’s screen was unchanged for ${minutes}` : `Screen unchanged for ${minutes}`;
    case 'input-permission':
      return say(
        'has not allowed Input Monitoring on their Mac — typing rhythm is only partly checked',
        'Input Monitoring not allowed on their Mac — typing rhythm is only partly checked',
      );
  }
}

const SEVERITY_DOT = { high: 'bg-red-400', medium: 'bg-orange-400' } as const;
const SEVERITY_LABEL = { high: 'High', medium: 'Medium' } as const;

/**
 * The ranked flag list — the attention-band recipe (DESIGN.md §5): attention
 * tint, a static dot per line, each line names its subject and offers its way
 * in, and the band states its own empty. Severity is the dot's hue *and* a
 * word for screen readers, never hue alone.
 */
export function FlagList({
  flags,
  withNames,
  hrefFor,
  cleanLine,
}: {
  flags: IntegrityFlag[];
  withNames: boolean;
  hrefFor?: (flag: IntegrityFlag) => string;
  /** The band's own empty, stated in full. */
  cleanLine: string;
}) {
  if (flags.length === 0) {
    return <p className="text-sm text-zinc-400">{cleanLine}</p>;
  }
  return (
    <section aria-label="Flags" className="rounded-xl border border-orange-500/20 bg-orange-500/[0.06] px-4 py-3">
      <ul className="space-y-1.5">
        {flags.map((f, i) => {
          const days = dayList(f.days);
          const sentence = flagSentence(f, withNames);
          return (
            <li key={`${f.uid}-${f.kind}-${i}`} className="flex items-start gap-2 text-sm">
              <span className={cn('mt-[7px] inline-block size-1.5 shrink-0 rounded-full', SEVERITY_DOT[f.severity])} aria-hidden />
              <span className="sr-only">{SEVERITY_LABEL[f.severity]}:</span>
              <span className="min-w-0">
                {hrefFor ? (
                  <Link href={hrefFor(f)} prefetch={false} className="underline-offset-2 hover:text-white hover:underline">
                    {sentence}
                  </Link>
                ) : (
                  sentence
                )}
                {days && <span className="text-[11px] text-zinc-400"> · {days}</span>}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * The agent's own coverage, as one bar: the track is clocked working time, the
 * fill is the part of it they were online in BuddyX. A fact, with no
 * threshold drawn — the agent view carries no flags.
 */
export function CoverageMeter({ coverage }: { coverage: CoverageFigures }) {
  const share = coverage.ratio ?? 0;
  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm">
          <span className="text-lg font-semibold tabular-nums">{formatShare(coverage.ratio)}</span>
          <span className="text-zinc-400"> of your clocked working time online in BuddyX</span>
        </p>
        <p className="text-[11px] text-zinc-400 tabular-nums">
          {formatDuration(coverage.onlineWhileClockedMs)} of {formatDuration(coverage.clockedMs)}
        </p>
      </div>
      <div
        className="mt-2 h-2 overflow-hidden rounded-full bg-white/[0.08]"
        role="img"
        aria-label={`Online in BuddyX for ${formatShare(coverage.ratio)} of clocked working time: ${formatDuration(coverage.onlineWhileClockedMs)} of ${formatDuration(coverage.clockedMs)}.`}
      >
        <div className="h-full rounded-full" style={{ width: `${Math.min(100, share * 100)}%`, background: SEQUENTIAL_COLOR }} />
      </div>
      {coverage.approximateDays > 0 && (
        <p className="mt-1.5 text-[11px] text-zinc-400">
          {coverage.approximateDays} {coverage.approximateDays === 1 ? 'day is' : 'days are'} judged on daily totals — hour-by-hour BuddyX data is still filling in.
        </p>
      )}
    </div>
  );
}

/** The table's flag cell: one greyscale chip per signal that crossed its line, else an em dash. */
export function FlagChips({ flags }: { flags: IntegrityFlag[] }) {
  if (flags.length === 0) return <span className="text-zinc-400">—</span>;
  const LABEL: Record<IntegrityFlag['kind'], string> = {
    'never-online': 'Never online',
    'low-coverage': 'Low coverage',
    'regular-input': 'Regular typing',
    'modifier-only': 'Modifier keys',
    'static-screen': 'Static screen',
    'input-permission': 'No permission',
  };
  return (
    <span className="inline-flex flex-wrap justify-end gap-1">
      {flags.map(f => (
        <span
          key={f.kind}
          title={flagSentence(f, false)}
          className="inline-flex items-center gap-1 rounded-md bg-white/[0.08] px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap text-zinc-300"
        >
          <span className={cn('inline-block size-1.5 rounded-full', SEVERITY_DOT[f.severity])} aria-hidden />
          <span className="sr-only">{SEVERITY_LABEL[f.severity]}:</span>
          {LABEL[f.kind]}
        </span>
      ))}
    </span>
  );
}

/** "Monitored 6h 40m · 3 of 26 captures unchanged" — what the integrity numbers rest on. */
export function integrityBasis(integrity: IntegritySummary | null): string {
  if (!integrity) return 'Not monitored';
  const parts = [`Monitored ${formatDuration(integrity.monitoredMinutes * MINUTE)}`];
  if (integrity.comparedCaptures > 0) parts.push(`${integrity.unchangedCaptures} of ${integrity.comparedCaptures} captures unchanged`);
  return parts.join(' · ');
}

// ─── Coverage scatter ────────────────────────────────────────────────

type Point = { uid: string; name: string; x: number; y: number; ratio: number | null };

const THRESHOLD = formatShare(COVERAGE_FLAG_RATIO);

const scatterConfig = {
  ok: { label: `At or above ${THRESHOLD}`, color: '#d4d4d8' },
  low: { label: `Below ${THRESHOLD}`, color: STATUS_HEX.orange },
  axis: { label: 'Axis', color: STATUS_HEX.zinc },
  parity: { label: 'Every clocked hour online', color: '#71717a' },
} satisfies ChartConfig;

/**
 * Every agent's week in one picture: clocked working hours across, hours
 * online in BuddyX *while clocked in* up. The solid diagonal is parity (every
 * clocked hour online); the dashed one is the `COVERAGE_FLAG_RATIO` line. A point under the
 * dashed line is the question this page exists to raise, and is the one hue on
 * the chart (status-orange, warning). Click a point for that agent's report;
 * the table below carries the same figures for the keyboard.
 */
export function CoverageScatter({ rows, hrefFor }: { rows: ChatterLeaderboardRow[]; hrefFor: (uid: string) => string }) {
  const router = useRouter();
  const points: Point[] = rows
    .filter(r => r.uid && r.coverage && r.coverage.clockedMs > 0)
    .map(r => ({
      uid: r.uid!,
      name: r.name,
      x: Math.round((r.coverage!.clockedMs / HOUR_MS) * 10) / 10,
      y: Math.round((r.coverage!.onlineWhileClockedMs / HOUR_MS) * 10) / 10,
      ratio: r.coverage!.ratio,
    }));
  if (points.length === 0) {
    return <p className="mt-3 text-sm text-zinc-400">Nobody was clocked in during this period.</p>;
  }
  const max = Math.max(1, ...points.map(p => Math.max(p.x, p.y))) * 1.08;
  const isLow = (p: Point) => p.ratio !== null && p.ratio < COVERAGE_FLAG_RATIO;
  const low = points.filter(isLow);
  const ok = points.filter(p => !isLow(p));
  const open = (data: unknown) => {
    const uid = (data as { payload?: Point })?.payload?.uid;
    if (uid) router.push(hrefFor(uid));
  };

  return (
    <div>
      {/* The dots are a mouse shortcut; the table below carries every figure and
          every report link, so the chart itself is hidden from assistive tech
          behind one summary sentence rather than exposing unreachable buttons. */}
      <p className="sr-only">
        Coverage for {points.length} agents: {low.length} below {THRESHOLD} of clocked working time online in BuddyX. Every agent is
        also listed in the table below.
      </p>
      <ChartContainer config={scatterConfig} className="mt-3 aspect-auto h-[300px] w-full" aria-hidden>
        <ScatterChart margin={{ left: 4, right: 16, top: 12, bottom: 8 }}>
          <CartesianGrid strokeOpacity={0.15} />
          <XAxis
            type="number"
            dataKey="x"
            domain={[0, max]}
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            tickFormatter={v => `${Math.round(v)}h`}
            label={{ value: 'Clocked working', position: 'insideBottomRight', offset: -4, fill: 'var(--color-axis)', fontSize: 11 }}
          />
          <YAxis
            type="number"
            dataKey="y"
            domain={[0, max]}
            tickLine={false}
            axisLine={false}
            width={40}
            tickFormatter={v => `${Math.round(v)}h`}
            label={{ value: 'Online while clocked', angle: -90, position: 'insideLeft', fill: 'var(--color-axis)', fontSize: 11, dy: 60 }}
          />
          <ZAxis range={[64, 64]} />
          <ReferenceLine segment={[{ x: 0, y: 0 }, { x: max, y: max }]} stroke="var(--color-parity)" strokeWidth={1} ifOverflow="hidden" />
          <ReferenceLine
            segment={[{ x: 0, y: 0 }, { x: max, y: max * COVERAGE_FLAG_RATIO }]}
            stroke={STATUS_HEX.orange}
            strokeOpacity={0.6}
            strokeDasharray="4 4"
            ifOverflow="hidden"
          />
          <ChartTooltip
            cursor={false}
            content={({ active, payload }) => {
              const p = active ? (payload?.[0]?.payload as Point | undefined) : undefined;
              if (!p) return null;
              return (
                <div className="rounded-lg border border-white/[0.07] bg-[var(--content-background)] px-3 py-2 text-xs">
                  <div className="font-medium text-white">{p.name}</div>
                  <div className="mt-0.5 text-zinc-400 tabular-nums">
                    {formatShare(p.ratio)} · {p.y}h online of {p.x}h clocked
                  </div>
                  <div className="mt-1 text-[11px] text-zinc-400">Click for the report</div>
                </div>
              );
            }}
          />
          <Scatter data={ok} fill="var(--color-ok)" className="cursor-pointer" onClick={open} isAnimationActive={false} />
          <Scatter data={low} fill="var(--color-low)" className="cursor-pointer" onClick={open} isAnimationActive={false} />
        </ScatterChart>
      </ChartContainer>
      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-zinc-400" aria-hidden>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-px w-4 bg-zinc-500" /> Every clocked hour online</span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block w-4 border-t border-dashed" style={{ borderColor: STATUS_HEX.orange }} /> {THRESHOLD} line
        </span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block size-2 rounded-full" style={{ background: STATUS_HEX.orange }} /> Below it</span>
      </div>
    </div>
  );
}
