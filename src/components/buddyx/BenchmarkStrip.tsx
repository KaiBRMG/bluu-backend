'use client';

import type { Benchmark } from '@/lib/buddyx/analyticsTypes';

/**
 * One agent against the team, on one metric — **anonymously** (DESIGN.md §5,
 * the benchmark strip).
 *
 * A horizontal track with two ticks — the team median and the top-quartile
 * mark — and one dot: you. The dot is the screen's single Action Blue mark,
 * because "you" is the current selection. Beside it, the value and a plain
 * reading ("faster than 3 of 4"). Direction-aware: on reply time, lower is
 * better, and the track runs so that better is always to the right.
 *
 * No colleague is drawn. The population's spread sets the scale; only its
 * median and quartile are marked.
 */
export function BenchmarkStrip({
  label,
  benchmark,
  format,
}: {
  label: string;
  benchmark: Benchmark;
  format: (value: number) => string;
}) {
  const { value, median, topQuartile, lowerIsBetter, beats, of } = benchmark;
  const points = [value, median, topQuartile].filter((v): v is number => v !== null);
  const max = Math.max(...points, 0) * 1.15 || 1;
  // Better is to the right: invert the axis for lower-is-better metrics.
  const pos = (v: number) => {
    const t = Math.min(1, Math.max(0, v / max));
    return `${(lowerIsBetter ? 1 - t : t) * 100}%`;
  };
  const verb = lowerIsBetter ? 'faster than' : 'ahead of';
  const reading = value === null ? 'No figure this period' : of === 0 ? 'No one to compare with' : `${verb} ${beats} of ${of}`;

  return (
    <div className="grid grid-cols-[9rem_minmax(0,1fr)_9rem] items-center gap-4 py-2">
      <span className="text-sm">{label}</span>
      <div
        className="relative h-6"
        role="img"
        aria-label={`${label}: you ${value === null ? 'have no figure' : format(value)}, team median ${median === null ? 'unknown' : format(median)}, ${reading}.`}
      >
        <span className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-white/[0.14]" aria-hidden />
        {median !== null && (
          <span className="absolute top-1 h-4 w-px bg-zinc-400" style={{ left: pos(median) }} title={`Team median ${format(median)}`} aria-hidden />
        )}
        {topQuartile !== null && (
          <span className="absolute top-1 h-4 w-px bg-zinc-200" style={{ left: pos(topQuartile) }} title={`Top quartile ${format(topQuartile)}`} aria-hidden />
        )}
        {value !== null && (
          <span
            className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-action-blue ring-2 ring-[var(--card)]"
            style={{ left: pos(value) }}
            aria-hidden
          />
        )}
      </div>
      <span className="text-right">
        <span className="block text-sm tabular-nums">{value === null ? '—' : format(value)}</span>
        <span className="block text-[11px] text-zinc-400">{reading}</span>
      </span>
    </div>
  );
}
