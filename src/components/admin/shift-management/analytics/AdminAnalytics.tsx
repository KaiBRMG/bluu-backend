'use client';

import { useMemo, useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader } from '@/components/ui/loader';
import { useAnalyticsData, type AnalyticsScope } from '@/hooks/useAnalyticsData';
import { AnalyticsFilterBar } from './AnalyticsFilterBar';
import { KpiRow } from './KpiRow';
import { WorkTrendChart } from './WorkTrendChart';
import { ActivityChart } from './ActivityChart';
import { AdherenceCard } from './AdherenceCard';
import { CoverageHeatmap } from './CoverageHeatmap';
import { FocusCard } from './FocusCard';
import { WellbeingCard } from './WellbeingCard';
import { UserComparisonTable } from './UserComparisonTable';
import {
  type PresetId, type DateRange, presetRange, validateRange, formatDateShort,
} from './analyticsTypes';

interface AdminAnalyticsProps {
  /** Shared with the Timesheets/Screenshots tabs so the selection carries across. */
  selectedUserId: string | null;
  onUserChange: (uid: string | null) => void;
}

export default function AdminAnalytics({ selectedUserId, onUserChange }: AdminAnalyticsProps) {
  const [scope, setScope] = useState<AnalyticsScope>('company');
  const [groupId, setGroupId] = useState<string | null>(null);
  const [preset, setPreset] = useState<PresetId>('30d');
  const [range, setRange] = useState<DateRange>(() => presetRange('30d'));

  const rangeError = useMemo(() => validateRange(range.start, range.end), [range]);

  const entityId = scope === 'user' ? selectedUserId : scope === 'group' ? groupId : null;

  // Passing null suppresses the request while the range is invalid, rather than
  // firing one the server would only reject.
  const { data, loading, error } = useAnalyticsData(
    scope,
    entityId,
    rangeError ? null : range.start,
    rangeError ? null : range.end,
  );

  const needsEntity = (scope === 'user' && !selectedUserId) || (scope === 'group' && !groupId);

  return (
    <div>
      <AnalyticsFilterBar
        scope={scope}
        onScopeChange={setScope}
        selectedUserId={selectedUserId}
        onUserChange={onUserChange}
        selectedGroupId={groupId}
        onGroupChange={setGroupId}
        preset={preset}
        range={range}
        onRangeChange={(p, r) => { setPreset(p); setRange(r); }}
      />

      {rangeError && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{rangeError}</AlertDescription>
        </Alert>
      )}

      {error && !rangeError && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {needsEntity ? (
        <div className="py-16 text-center text-sm" style={{ color: 'var(--foreground-muted)' }}>
          Select {scope === 'user' ? 'an employee' : 'a group'} to view analytics.
        </div>
      ) : loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader />
        </div>
      ) : !data ? null : data.meta.rollupCount === 0 ? (
        <div className="py-16 text-center text-sm" style={{ color: 'var(--foreground-muted)' }}>
          No tracked activity between {formatDateShort(range.start)} and {formatDateShort(range.end)}.
        </div>
      ) : (
        <>
          <KpiRow data={data} />

          {/* Say plainly what the numbers are and are not. */}
          <p className="text-xs mb-4" style={{ color: 'var(--foreground-muted)' }}>
            {formatDateShort(data.range.start)} – {formatDateShort(data.range.end)} ·{' '}
            Computed nightly, so data ends yesterday · Each day is counted in that person&apos;s own timezone
            {scope === 'group' && ' · Group membership is read as it is today, not as it was then'}
            {data.meta.provisionalDays > 0 && (
              <> · <strong>{data.meta.provisionalDays} day{data.meta.provisionalDays === 1 ? '' : 's'} provisional</strong>
                {' '}(a device has not yet uploaded its log — totals may rise)</>
            )}
          </p>

          <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))' }}>
            <div style={{ gridColumn: '1 / -1' }}>
              <WorkTrendChart series={data.series} />
            </div>

            <div style={{ gridColumn: '1 / -1' }}>
              <CoverageHeatmap heatmap={data.heatmap} />
            </div>

            <AdherenceCard adherence={data.adherence} />
            <WellbeingCard wellbeing={data.wellbeing} byUser={data.byUser} />

            <FocusCard focus={data.focus} />
            <ActivityChart totals={data.totals} series={data.series} />

            {/* Individual scope is one person — a comparison table of one row is noise. */}
            {scope !== 'user' && (
              <div style={{ gridColumn: '1 / -1' }}>
                <UserComparisonTable byUser={data.byUser} />
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
