'use client';

import { memo } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { SURFACE } from '@/lib/surfaces';
import { cn } from '@/lib/utils';
import { formatClock } from '@/lib/shiftOverview';
import { todaySessionWorkedSeconds } from '@/hooks/useTodaySessions';
import {
  NOT_COUNTED_INK,
  SEGMENT_COLOR,
  SEGMENT_LABEL,
  coalesce,
  formatDuration,
  totalsByKind,
  type SegmentKind,
} from '@/lib/timesheet/daySegments';
import type { TodayModel } from './useTodayModel';

const HATCH = `repeating-linear-gradient(135deg, ${NOT_COUNTED_INK} 0 3px, transparent 3px 6px)`;
const SIDE_KINDS: SegmentKind[] = ['break', 'idle', 'pause', 'not-counted'];

/**
 * Today's sessions, one row each, every row's track on the ring's scale so a
 * session sits where it sits on the arc. Sessions tracked on another device
 * appear too (`useTodaySessions` merges the ledger in).
 */
export const TodaySessions = memo(function TodaySessions({ model, timezone }: { model: TodayModel; timezone: string }) {
  const { sessions, span, now, loading } = model;

  if (loading && sessions.length === 0) {
    return (
      <div className={cn('rounded-xl p-2', SURFACE)}>
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="grid grid-cols-[9rem_1fr_7rem] items-center gap-6 px-4 py-4">
            <div className="space-y-1.5"><Skeleton className="h-4 w-28" /><Skeleton className="h-3 w-16" /></div>
            <Skeleton className="h-2 w-full rounded-full" />
            <div className="space-y-1.5 justify-items-end grid"><Skeleton className="h-4 w-14" /><Skeleton className="h-3 w-20" /></div>
          </div>
        ))}
      </div>
    );
  }

  if (sessions.length === 0) {
    return <p className="px-1 py-2 text-sm text-zinc-400">Nothing tracked today.</p>;
  }

  const pct = (ms: number) => {
    if (!span) return 0;
    return Math.max(0, Math.min(100, ((ms - span.start) / (span.end - span.start)) * 100));
  };

  return (
    <ol className={cn('@container rounded-xl divide-y divide-white/[0.07]', SURFACE)}>
      {sessions.map(({ session, segments }) => {
        const drawn = coalesce(segments);
        const totals = totalsByKind(segments);
        const worked = todaySessionWorkedSeconds(session, now);
        const end = session.isLive ? null : (session.endTime ?? drawn.at(-1)?.endMs ?? null);
        const side = SIDE_KINDS.filter(k => totals[k] > 0)
          .map(k => `${SEGMENT_LABEL[k]} ${formatDuration(totals[k])}`)
          .join(' · ');
        const range = `${formatClock(session.startTime, timezone)} – ${end === null ? 'now' : formatClock(end, timezone)}`;

        return (
          <li
            key={session.sessionId}
            className="grid grid-cols-[1fr_auto] items-center gap-x-6 gap-y-3 px-5 py-4 @[36rem]:grid-cols-[9rem_1fr_9rem]"
          >
            <div>
              <div className="text-sm font-medium tabular-nums">{range}</div>
              <div className="text-xs text-zinc-400">
                {session.isLive ? 'In progress' : session.isManual ? 'Manual entry' : 'Clocked out'}
              </div>
            </div>

            <div
              className="relative order-last col-span-2 h-2 overflow-hidden rounded-full bg-white/[0.06] @[36rem]:order-none @[36rem]:col-span-1"
              aria-hidden="true"
            >
              {drawn.map(seg => (
                <span
                  key={`${seg.kind}-${seg.startMs}`}
                  className="absolute inset-y-0"
                  style={{
                    left: `${pct(seg.startMs)}%`,
                    width: `max(2px, ${pct(seg.endMs) - pct(seg.startMs)}%)`,
                    background: seg.kind === 'not-counted' ? HATCH : SEGMENT_COLOR[seg.kind],
                  }}
                />
              ))}
            </div>

            <div className="text-right">
              <div className="text-sm font-medium tabular-nums">{formatDuration(worked)}</div>
              <div className="text-xs text-zinc-400 tabular-nums">{side || 'No breaks or idle'}</div>
            </div>
          </li>
        );
      })}
    </ol>
  );
});
