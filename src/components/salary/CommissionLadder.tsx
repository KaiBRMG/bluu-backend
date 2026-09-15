'use client';

import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { formatPercent, formatUsd, formatUsdCompact } from '@/lib/salary/salaryFormat';
import type { SalaryConfig, SalaryTierProgress } from '@/lib/salary/salaryTypes';

/**
 * The commission scale, drawn as the stepped ladder it actually is.
 *
 * A single progress bar was the obvious component and it is the wrong one: the
 * scale is not continuous. Crossing $4,000 does not nudge the rate, it *steps*
 * it, and the bands are unequal widths ($4k, $4k, $4k, then open-ended). A bar
 * flattens all of that into one percentage and answers the only question the
 * agent has — "how much further" — less well than four labelled segments do.
 *
 * So: one segment per tier, sized to its band, the current band filled and every
 * threshold labelled. The top tier has no ceiling, so it is drawn narrower than
 * its data would imply and carries no target — a segment that could never fill
 * would read as permanent incompleteness.
 *
 * Colour is rationed to one voice: the tiers behind you are a neutral overlay,
 * the band you are in is Action Blue, the bands ahead are empty. Nothing
 * gradients and nothing animates on a loop — this sits on a console people look
 * at all day (DESIGN.md §2, §5).
 */

interface CommissionLadderProps {
  tier: SalaryTierProgress;
  config: SalaryConfig;
  /** Month-to-date gross — the value the marker sits at. */
  cumulativeGross: number;
  /** `compact` drops the axis labels for the dashboard card. */
  variant?: 'compact' | 'full';
  className?: string;
}

/** Width given to the open-ended top band, relative to the widest real band. */
const TOP_BAND_RATIO = 0.7;

export function CommissionLadder({
  tier,
  config,
  cumulativeGross,
  variant = 'full',
  className,
}: CommissionLadderProps) {
  const segments = useMemo(() => {
    const tiers = [...config.commissionTiers].sort((a, b) => a.minGross - b.minGross);
    if (tiers.length === 0) return [];

    const spans = tiers.map((t, i) => {
      const next = tiers[i + 1];
      return next ? next.minGross - t.minGross : 0;
    });
    const widest = Math.max(...spans.filter(s => s > 0), 1);

    return tiers.map((t, i) => {
      const next = tiers[i + 1];
      const span = next ? next.minGross - t.minGross : widest * TOP_BAND_RATIO;

      // How full this segment is: complete for bands already passed, partial for
      // the one the agent is in, empty ahead. The top band fills as soon as it
      // is reached — there is nothing left to progress toward.
      let fill = 0;
      if (cumulativeGross >= (next?.minGross ?? Infinity)) fill = 1;
      else if (cumulativeGross > t.minGross) fill = next ? (cumulativeGross - t.minGross) / span : 1;

      return {
        // Indexed, not keyed on the rate. The tier table is editable in CA Admin →
        // Rates, and a repeated percent there would light two bands as "current"
        // *and* collide these React keys.
        index: i,
        percent: t.percent,
        floor: t.minGross,
        ceiling: next?.minGross ?? null,
        span,
        fill: Math.min(1, Math.max(0, fill)),
        isCurrent: t.percent === tier.currentPercent,
        isPassed: next !== undefined && cumulativeGross >= next.minGross,
      };
    });
  }, [config.commissionTiers, cumulativeGross, tier.currentPercent]);

  if (segments.length === 0) return null;

  const totalSpan = segments.reduce((sum, s) => sum + s.span, 0);

  return (
    <div className={cn('w-full', className)}>
      {/* Rate labels sit above their own band, so the reader never has to map a
          legend onto a bar. The current one is the only one inked. */}
      <div className="flex w-full items-end gap-1" aria-hidden>
        {segments.map(segment => (
          <div key={segment.index} style={{ flexGrow: segment.span / totalSpan }} className="min-w-0">
            <span
              className={cn(
                'block truncate text-[11px] font-semibold tabular-nums transition-colors duration-[120ms]',
                segment.isCurrent ? 'text-[#3b82f6]' : 'text-zinc-400',
              )}
            >
              {formatPercent(segment.percent)}
            </span>
          </div>
        ))}
      </div>

      {/* The rail. Segments are separate elements with a gap rather than one bar
          with tick marks, because the steps are the point. */}
      <div className="mt-1.5 flex w-full items-center gap-1">
        {segments.map(segment => (
          <div
            key={segment.index}
            style={{ flexGrow: segment.span / totalSpan }}
            className={cn(
              'relative h-2 min-w-0 overflow-hidden rounded-full',
              segment.isCurrent ? 'bg-[#3b82f6]/15' : 'bg-white/[0.07]',
            )}
          >
            <div
              className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-300 ease-out"
              style={{
                width: `${segment.fill * 100}%`,
                backgroundColor: segment.isCurrent ? '#3b82f6' : 'rgba(255,255,255,0.28)',
              }}
            />
          </div>
        ))}
      </div>

      {variant === 'full' && (
        <div className="mt-1.5 flex w-full gap-1" aria-hidden>
          {segments.map(segment => (
            <div key={segment.index} style={{ flexGrow: segment.span / totalSpan }} className="min-w-0">
              <span className="block truncate text-[11px] tabular-nums text-zinc-400">
                {formatUsdCompact(segment.floor)}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* The sentence is the actual answer; the rail is the context for it. */}
      <p className="mt-2.5 text-sm text-zinc-400">
        {tier.grossToNext === null || tier.nextPercent === null ? (
          <>
            You&apos;re on the top rate of{' '}
            <span className="font-semibold tabular-nums text-foreground">{formatPercent(tier.currentPercent)}</span> for
            the rest of the month.
          </>
        ) : (
          <>
            <span className="font-semibold tabular-nums text-foreground">{formatUsd(tier.grossToNext)}</span> more in
            sales to reach{' '}
            <span className="font-semibold tabular-nums text-foreground">{formatPercent(tier.nextPercent)}</span>.
          </>
        )}
      </p>

      {/* One line for a screen reader, rather than a dozen labelled segments. */}
      <span className="sr-only">
        {`Commission rate ${formatPercent(tier.currentPercent)}. ` +
          (tier.grossToNext === null
            ? 'This is the highest rate.'
            : `${formatUsd(tier.grossToNext)} more in sales to reach ${formatPercent(tier.nextPercent ?? 0)}.`)}
      </span>
    </div>
  );
}
