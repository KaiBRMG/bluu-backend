'use client';

import { useEffect, useMemo, useState } from 'react';
import { RefreshCcw } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useAnalyticsData } from '@/hooks/useAnalyticsData';
import { useShiftOverview } from '@/hooks/useShiftOverview';
import { STATE_CONFIG } from '@/lib/stateColors';
import {
  deriveAttention,
  LIVE_STATES,
  type LiveState,
  formatClock,
  type AttentionTarget,
  type LiveSession,
  type OverviewPerson,
} from '@/lib/shiftOverview';
import { presetRange } from '../analytics/analyticsTypes';
import { AttentionQueue } from './AttentionQueue';
import { TodayTimeline } from './TodayTimeline';
import { TeamWeek, WeekSummary } from './WeekPanels';

export type PersonSection = 'timeline' | 'screenshots' | 'shifts' | 'analytics' | 'leave' | 'settings';

/**
 * A minute clock for the derivations that age ("idle for 24m", "not in yet").
 * Once a minute, aligned to the minute — not the 1 Hz tick the docs warn
 * preempts navigation (CLAUDE.md, sidebar hang issue 2).
 */
function useMinuteClock(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | undefined;
    const timeout = setTimeout(() => {
      setNow(Date.now());
      interval = setInterval(() => setNow(Date.now()), 60_000);
    }, 60_000 - (Date.now() % 60_000));
    return () => { clearTimeout(timeout); if (interval) clearInterval(interval); };
  }, []);
  return now;
}

const WEEK_RANGE = presetRange('7d');

interface ShiftOverviewProps {
  /** The page's single `active_sessions` listener, shared with the person sheet. */
  activeSessions: LiveSession[];
  liveLoading: boolean;
  onOpenPerson: (uid: string, section?: PersonSection, date?: string) => void;
  onOpenAnalytics: () => void;
}

export default function ShiftOverview({ activeSessions, liveLoading, onOpenPerson, onOpenAnalytics }: ShiftOverviewProps) {
  const now = useMinuteClock();
  const { data, loading, refreshing, error, refresh } = useShiftOverview();
  const week = useAnalyticsData('company', null, WEEK_RANGE.start, WEEK_RANGE.end);

  const people = useMemo(
    () => new Map<string, OverviewPerson>((data?.people ?? []).map(p => [p.uid, p])),
    [data],
  );

  // `useActiveUsers` rows are a structural superset of LiveSession — filter only.
  const live: LiveSession[] = useMemo(
    () => activeSessions.filter(s => people.has(s.userId)),
    [activeSessions, people],
  );

  const items = useMemo(() => (data ? deriveAttention(data, live, now) : []), [data, live, now]);

  const counts = useMemo(() => {
    const byState = Object.fromEntries(LIVE_STATES.map(st => [st, 0])) as Record<LiveState, number>;
    for (const s of live) byState[s.currentState] += 1;
    const todayShifts = (data?.shifts ?? []).filter(
      s => data && s.end > data.todayBounds.start && s.start < data.todayBounds.end,
    );
    const scheduled = new Set(todayShifts.map(s => s.userId)).size;
    const yetToStart = new Set(todayShifts.filter(s => s.start > now).map(s => s.userId)).size;
    return { byState, scheduled, yetToStart };
  }, [live, data, now]);

  const clearContext = `${live.length} clocked in · ${counts.scheduled} scheduled today · no missed shifts or open records since yesterday`;
  const openFromQueue = (uid: string, target: AttentionTarget, date: string) => onOpenPerson(uid, target, date);
  const firstLoad = loading || liveLoading;

  return (
    <div className="space-y-4">
      {/* Status line: the floor in one sentence. */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        {firstLoad ? (
          <Skeleton className="h-5 w-96 max-w-full" />
        ) : (
          <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <span>
              <span className="font-semibold tabular-nums">{live.length}</span>{' '}
              <span className="text-zinc-400">clocked in</span>
            </span>
            {LIVE_STATES.map(state =>
              counts.byState[state] > 0 ? (
                <span key={state} className="inline-flex items-center gap-1.5">
                  <span aria-hidden className="inline-block size-2 rounded-full" style={{ background: STATE_CONFIG[state].color }} />
                  <span className="tabular-nums">{counts.byState[state]}</span>
                  <span className="text-zinc-400">{STATE_CONFIG[state].label.toLowerCase()}</span>
                </span>
              ) : null,
            )}
            <span aria-hidden className="h-4 w-px bg-white/[0.1]" />
            <span>
              <span className="tabular-nums">{counts.scheduled}</span>{' '}
              <span className="text-zinc-400">scheduled today</span>
              {counts.yetToStart > 0 && (
                <span className="text-zinc-400"> · <span className="tabular-nums text-zinc-200">{counts.yetToStart}</span> still to start</span>
              )}
            </span>
          </p>
        )}
        <div className="ml-auto flex items-center gap-2">
          {data && (
            <span className="text-[11px] tabular-nums text-zinc-400">
              Shifts as of {formatClock(data.generatedAt, data.timezone)} · live states update on their own
            </span>
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Refresh shifts and records"
            className="text-zinc-400 hover:text-white"
            onClick={refresh}
            disabled={refreshing}
          >
            <RefreshCcw className={refreshing ? 'activity-spinner animate-spin' : undefined} />
          </Button>
        </div>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>Couldn&apos;t load today&apos;s shifts and records: {error}</AlertDescription>
        </Alert>
      )}

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-4">
          <AttentionQueue
            items={items}
            people={people}
            loading={firstLoad}
            clearContext={clearContext}
            onOpen={openFromQueue}
          />
          <TodayTimeline
            data={data}
            live={live}
            people={people}
            now={now}
            loading={firstLoad}
            onOpen={uid => onOpenPerson(uid, 'timeline', data?.today)}
          />
        </div>
        <WeekSummary
          data={week.data}
          loading={week.loading && !week.data}
          error={week.error}
          onOpenAnalytics={onOpenAnalytics}
        />
      </div>

      <TeamWeek
        data={week.data}
        loading={week.loading && !week.data}
        onOpen={uid => onOpenPerson(uid, 'analytics')}
      />
    </div>
  );
}
