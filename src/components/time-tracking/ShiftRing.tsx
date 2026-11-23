'use client';

import { memo, useId } from 'react';
import type { Segment } from '@/lib/timesheet/daySegments';
import { NOT_COUNTED_INK, SEGMENT_COLOR, coalesce } from '@/lib/timesheet/daySegments';
import type { ShiftSpan } from '@/lib/shiftSpans';
import { formatClock } from '@/lib/shiftOverview';

/* ── Geometry ─────────────────────────────────────────────────────────
   A 280° gauge with its 80° gap at the bottom, so the arc has a readable
   start (lower left) and end (lower right) and the span's two times sit in the
   gap. Angles are degrees clockwise from 12 o'clock. */

export const RING_SIZE = 300;
const C = RING_SIZE / 2;
const R = 128;          // the state track
const TRACK_W = 14;
const SHIFT_R = R + 15; // the dashed shift arc, outside the track
const SWEEP = 280;
const A0 = -SWEEP / 2;  // -140°: lower left
const MIN_SWEEP = 0.8;  // a one-minute blip still reads as a mark


function point(r: number, deg: number): [number, number] {
  const rad = (deg * Math.PI) / 180;
  return [C + r * Math.sin(rad), C - r * Math.cos(rad)];
}

function arc(r: number, from: number, to: number): string {
  const [x1, y1] = point(r, from);
  const [x2, y2] = point(r, to);
  const large = to - from > 180 ? 1 : 0;
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

interface ShiftRingProps {
  span: ShiftSpan | null;
  shift: ShiftSpan | null;
  segments: Segment[];
  now: number;
  timezone: string;
  /** Full-sentence description for assistive tech; the ring is one image. */
  label: string;
  hovered: Segment | null;
  onHover: (seg: Segment | null) => void;
}

/**
 * The day drawn around the clock: today's span as a 280° arc, each tracked
 * span filled in its `STATE_CONFIG` hue, not-counted time hatched, the
 * scheduled shift as a dashed arc outside it, and a hairline at now.
 *
 * Re-renders only when its minute-resolution inputs change (memo), never on
 * the clock's per-second tick.
 */
function ShiftRingImpl({ span, shift, segments, now, timezone, label, hovered, onHover }: ShiftRingProps) {
  const hatchId = useId();

  const angle = (ms: number): number => {
    if (!span) return A0;
    const f = (ms - span.start) / (span.end - span.start);
    return A0 + SWEEP * Math.max(0, Math.min(1, f));
  };

  const drawn = coalesce(segments);
  const nowInSpan = !!span && now >= span.start && now <= span.end;
  const [lx, ly] = point(R, A0);
  const [rx, ry] = point(R, A0 + SWEEP);

  return (
    <svg
      viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}
      width={RING_SIZE}
      height={RING_SIZE}
      role="img"
      aria-label={label}
      className="block max-w-full h-auto"
      onPointerLeave={() => onHover(null)}
    >
      <defs>
        <pattern id={hatchId} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="3" height="6" fill={NOT_COUNTED_INK} />
        </pattern>
      </defs>

      {/* Track */}
      <path d={arc(R, A0, A0 + SWEEP)} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={TRACK_W} strokeLinecap="round" />

      {/* Scheduled shift — dashed, outside the track (DESIGN.md: the scheduled window is a dashed outline). */}
      {shift && span && (
        <path
          d={arc(SHIFT_R, angle(shift.start), Math.max(angle(shift.end), angle(shift.start) + MIN_SWEEP))}
          fill="none"
          stroke="rgba(255,255,255,0.4)"
          strokeWidth={1.5}
          strokeDasharray="3 4"
        />
      )}

      {/* Tracked spans */}
      {drawn.map(seg => {
        const a = angle(seg.startMs);
        const b = Math.max(angle(seg.endMs), a + MIN_SWEEP);
        const dim = hovered !== null && (hovered.startMs !== seg.startMs || hovered.kind !== seg.kind);
        return (
          <path
            key={`${seg.kind}-${seg.startMs}`}
            d={arc(R, a, b)}
            fill="none"
            stroke={seg.kind === 'not-counted' ? `url(#${hatchId})` : SEGMENT_COLOR[seg.kind]}
            strokeWidth={TRACK_W}
            style={{ opacity: dim ? 0.35 : 1, transition: 'opacity 120ms ease-out' }}
            onPointerEnter={() => onHover(seg)}
          />
        );
      })}

      {/* Now */}
      {nowInSpan && (() => {
        const a = angle(now);
        const [x1, y1] = point(R - TRACK_W / 2 - 4, a);
        const [x2, y2] = point(R + TRACK_W / 2 + 4, a);
        return <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="rgba(255,255,255,0.6)" strokeWidth={2} strokeLinecap="round" />;
      })()}

      {/* The span's two ends, in the gap */}
      {span && (
        <g fill="#a1a1aa" fontSize="12" fontWeight={500} style={{ fontVariantNumeric: 'tabular-nums' }}>
          <text x={lx} y={ly + 30} textAnchor="middle">{formatClock(span.start, timezone)}</text>
          <text x={rx} y={ry + 30} textAnchor="middle">{formatClock(span.end, timezone)}</text>
        </g>
      )}
    </svg>
  );
}

export const ShiftRing = memo(ShiftRingImpl);
