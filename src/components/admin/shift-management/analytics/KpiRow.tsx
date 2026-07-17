'use client';

import type { AnalyticsData } from '@/hooks/useAnalyticsData';
import { formatDuration, formatPercent } from './analyticsTypes';

interface StatTileProps {
  label: string;
  value: string;
  hint?: string;
}

/**
 * A stat tile, not a chart — a single headline number's job is to be read, and
 * a chart around it would only add ink.
 */
function StatTile({ label, value, hint }: StatTileProps) {
  return (
    <div
      className="rounded-lg p-4 flex flex-col gap-1"
      style={{ background: 'var(--background)', border: '1px solid var(--border-subtle)' }}
    >
      <span className="text-xs" style={{ color: 'var(--foreground-muted)' }}>{label}</span>
      <span className="text-2xl font-semibold tabular-nums">{value}</span>
      {hint && (
        <span className="text-xs" style={{ color: 'var(--foreground-muted)' }}>{hint}</span>
      )}
    </div>
  );
}

export function KpiRow({ data }: { data: AnalyticsData }) {
  const { totals, adherence, focus } = data;

  return (
    <div className="grid gap-3 mb-6" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
      <StatTile
        label="Total worked"
        value={formatDuration(totals.workingSeconds + totals.breakSeconds)}
        hint={`${formatDuration(totals.workingSeconds)} working + ${formatDuration(totals.breakSeconds)} break`}
      />
      <StatTile
        label="Avg / day worked"
        value={totals.avgDayWorkingSeconds !== null ? formatDuration(totals.avgDayWorkingSeconds) : '—'}
        hint={`${totals.daysWorked} day${totals.daysWorked === 1 ? '' : 's'} with activity`}
      />
      <StatTile
        label="Activity"
        value={totals.activityMean !== null ? `${Math.round(totals.activityMean)}%` : '—'}
        hint={`${totals.screenshotCount} capture${totals.screenshotCount === 1 ? '' : 's'} · input, not output`}
      />
      <StatTile
        label="Punctuality"
        value={formatPercent(adherence.punctuality)}
        hint={`${adherence.late} late · ${adherence.absent} absent`}
      />
      <StatTile
        label="Focus time"
        value={formatDuration(focus.focusSecondsInBlocks)}
        hint={`${focus.focusBlockCount} block${focus.focusBlockCount === 1 ? '' : 's'} ≥25m`}
      />
      <StatTile
        label="Active people"
        value={String(totals.activeUserCount)}
        hint={`of ${data.rosterSize} on the roster`}
      />
    </div>
  );
}
