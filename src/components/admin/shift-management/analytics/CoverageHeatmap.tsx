'use client';

import { SEQUENTIAL_HUE, WEEKDAY_LABELS, formatDuration } from './analyticsTypes';
import { ChartCard } from './ChartCard';

/**
 * Weekday × local-hour coverage. A CSS grid rather than recharts, which has no
 * heatmap primitive.
 *
 * Sequential encoding: one hue, opacity-ramped. On this dark surface "near
 * zero" resolves to the surface itself and magnitude reads as increasing
 * luminance — never a rainbow.
 */
export function CoverageHeatmap({ heatmap }: { heatmap: number[][] }) {
  const max = Math.max(0, ...heatmap.flat());
  const empty = max === 0;

  // Fixed break so a cell's colour means the same thing across renders.
  const intensity = (v: number) => (max === 0 ? 0 : Math.min(1, v / max));

  return (
    <ChartCard
      title="Coverage"
      description="Working hours by weekday and local hour — when people are actually online."
      empty={empty}
      emptyMessage="No coverage data in this range."
      className="overflow-hidden"
    >
      <div className="overflow-x-auto">
        <div style={{ minWidth: '640px' }}>
          {/* Hour axis */}
          <div className="flex items-center gap-[2px] mb-1 pl-[34px]">
            {Array.from({ length: 24 }, (_, h) => (
              <div
                key={h}
                className="flex-1 text-center"
                style={{ fontSize: '9px', color: 'var(--foreground-muted)' }}
              >
                {h % 3 === 0 ? h : ''}
              </div>
            ))}
          </div>

          {heatmap.map((row, wd) => (
            <div key={wd} className="flex items-center gap-[2px] mb-[2px]">
              <div
                className="text-right pr-2"
                style={{ width: '34px', fontSize: '10px', color: 'var(--foreground-muted)' }}
              >
                {WEEKDAY_LABELS[wd]}
              </div>
              {row.map((v, h) => (
                <div
                  key={h}
                  title={`${WEEKDAY_LABELS[wd]} ${String(h).padStart(2, '0')}:00 — ${formatDuration(v)}`}
                  className="flex-1 rounded-[2px]"
                  style={{
                    height: '18px',
                    background: v > 0 ? SEQUENTIAL_HUE : 'transparent',
                    opacity: v > 0 ? 0.15 + intensity(v) * 0.85 : 1,
                    border: v > 0 ? 'none' : '1px solid var(--border-subtle)',
                  }}
                />
              ))}
            </div>
          ))}

          {/* Legend — magnitude needs a scale, not just a hue */}
          <div className="flex items-center gap-2 mt-3 pl-[34px]">
            <span style={{ fontSize: '10px', color: 'var(--foreground-muted)' }}>0</span>
            {[0.15, 0.35, 0.55, 0.75, 1].map(o => (
              <div
                key={o}
                className="rounded-[2px]"
                style={{ width: '22px', height: '10px', background: SEQUENTIAL_HUE, opacity: o }}
              />
            ))}
            <span style={{ fontSize: '10px', color: 'var(--foreground-muted)' }}>
              {formatDuration(max)}
            </span>
          </div>
        </div>
      </div>
    </ChartCard>
  );
}
