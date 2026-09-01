'use client';

import { useId } from 'react';
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
export function Sparkline({
  points,
  highlighted = false,
  width = 88,
  height = 24,
}: {
  points: SeriesPoint[];
  highlighted?: boolean;
  width?: number;
  height?: number;
}) {
  const gradientId = useId();

  if (points.length < 2) {
    // One reading cannot describe a trend, and a flat line implies it measured
    // one. A hairline says "nothing to draw yet" without pretending otherwise.
    return (
      <svg width={width} height={height} aria-hidden className="overflow-visible">
        <line
          x1={0} y1={height / 2} x2={width} y2={height / 2}
          stroke="rgba(255,255,255,0.12)" strokeWidth={1} strokeDasharray="2 3"
        />
      </svg>
    );
  }

  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  // A perfectly flat series would divide by zero; centre it instead.
  const span = max - min || 1;
  const pad = 2;

  const coords = points.map((p, i) => {
    const x = (i / (points.length - 1)) * width;
    const y = height - pad - ((p.value - min) / span) * (height - pad * 2);
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });

  const stroke = highlighted ? '#3b82f6' : 'rgba(255,255,255,0.32)';

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden
      className="overflow-visible"
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
        style={{ transition: 'stroke 120ms ease-out' }}
      />
    </svg>
  );
}
