'use client';

import { memo, useId } from 'react';
import { cn } from '@/lib/utils';
import type { SeriesPoint } from '@/lib/growth/metrics';

/**
 * An inline trend mark for a table row.
 *
 * Hand-drawn SVG rather than a recharts instance: a dozen `ResponsiveContainer`s
 * in a table body each add a resize observer and a render tree for something
 * that is forty path points and no interaction. This is the cheaper primitive,
 * not a rejection of the house chart component.
 *
 * It is decoration in the strict sense — the number beside it carries the fact —
 * so it is drawn greyscale unless the row is highlighted, and it is
 * `aria-hidden`: the delta cell already states the same thing in words.
 */
export const Sparkline = memo(function Sparkline({
  points,
  highlighted = false,
  width = 88,
  height = 24,
  stroke: strokeOverride,
  zeroBased = false,
  className,
}: {
  points: SeriesPoint[];
  highlighted?: boolean;
  /**
   * Also the viewBox width — pass `className="w-full"` to let it stretch.
   *
   * `preserveAspectRatio="none"` means the viewBox is scaled on each axis
   * independently, so pick a width at or above the widest box this will render
   * in: compressing a wide viewBox is invisible, while stretching a narrow one
   * spreads the points apart without thickening the stroke with them. The card
   * grid is `minmax(min(100%, 250px), 1fr)`, so a sparse roster on a wide window
   * gives each card 400px+ — which is why the card passes 480 rather than the
   * 220 it renders at when the grid is full.
   */
  width?: number;
  height?: number;
  /**
   * Force the trace's colour. Left undefined the mark is greyscale (or Action
   * Blue while highlighted), which is right on a shared axis where hue is
   * reserved for the selected trace. On an account card there is no shared axis,
   * so the caller tints it to match the delta beside it — one fact, stated twice.
   */
  stroke?: string;
  /**
   * Anchor the vertical scale at zero instead of at the series' own minimum.
   * Only for a series where zero is a meaningful floor (a rate decaying to
   * nothing); on an absolute count it flattens the shape the mark exists to show.
   */
  zeroBased?: boolean;
  className?: string;
}) {
  // React 19 emits ids like `«r0»`. A fragment reference resolves today, but
  // React's own guidance is not to put a generated id into a selector — stripped
  // to word characters it is a plain, portable id.
  const gradientId = `growth-spark-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;

  if (points.length < 2) {
    // One reading cannot describe a trend, and a flat line implies it measured
    // one. A hairline says "nothing to draw yet" without pretending otherwise.
    return (
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        aria-hidden
        className={cn('overflow-visible', className)}
      >
        <line
          x1={0} y1={height / 2} x2={width} y2={height / 2}
          stroke="rgba(255,255,255,0.12)" strokeWidth={1} strokeDasharray="2 3"
          // Without this, the non-uniform scale stretches the dashes too.
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    );
  }

  const values = points.map((p) => p.value);
  // Zero-based makes "has this settled?" readable, because the floor stops being
  // whatever the series' own worst point happened to be. It is only right for a
  // series where zero *means* something — a rate that decays to nothing — and
  // wrong for the follower counts this mark usually draws, where a zero baseline
  // flattens a good month into a straight line. Hence a prop, not a default.
  const min = zeroBased ? Math.min(0, ...values) : Math.min(...values);
  const max = zeroBased ? Math.max(0, ...values) : Math.max(...values);
  // A perfectly flat series would divide by zero; centre it instead.
  const span = max - min || 1;
  const pad = 2;

  const coords = points.map((p, i) => {
    const x = (i / (points.length - 1)) * width;
    const y = height - pad - ((p.value - min) / span) * (height - pad * 2);
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });

  // Highlight still wins: it marks the row the cursor is on, which must read
  // even on a card whose trace is already tinted.
  const stroke = highlighted ? '#3b82f6' : strokeOverride ?? 'rgba(255,255,255,0.32)';

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      aria-hidden
      className={cn('overflow-visible', className)}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity={0.22} />
          <stop offset="100%" stopColor={stroke} stopOpacity={0} />
        </linearGradient>
      </defs>
      <polygon
        points={`0,${height} ${coords.join(' ')} ${width},${height}`}
        fill={`url(#${gradientId})`}
      />
      <polyline
        points={coords.join(' ')}
        fill="none"
        stroke={stroke}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        // The viewBox is scaled per axis (`preserveAspectRatio="none"`), which
        // otherwise thins the stroke on near-vertical segments and thickens it
        // on horizontal ones — one line drawn at two weights. This keeps 1.5px
        // meaning 1.5px whatever the box does.
        vectorEffect="non-scaling-stroke"
        style={{ transition: 'stroke 120ms ease-out' }}
      />
    </svg>
  );
});
