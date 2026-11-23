'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Coffee, Info, Pause } from 'lucide-react';
import { useTimeTracking } from '@/hooks/useTimeTracking';
import { useDayTotal } from '@/hooks/useDayTotal';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ClockOutButton } from '@/components/ClockOutButton';
import { STATE_CONFIG } from '@/lib/stateColors';
import { SURFACE } from '@/lib/surfaces';
import { cn } from '@/lib/utils';
import { formatClock } from '@/lib/shiftOverview';
import { BREAK_BLOCKED_TOOLTIP } from '@/lib/shiftBreakPolicy';
import {
  SEGMENT_KINDS,
  SEGMENT_LABEL,
  formatDuration,
  type Segment,
  type SegmentKind,
} from '@/lib/timesheet/daySegments';
import { ShiftRing } from './ShiftRing';
import { SegmentSwatch } from './SegmentSwatch';
import type { TodayModel } from './useTodayModel';

function formatHms(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/** Where today's shift stands, in words. Null when there is no shift today. */
function shiftStatus(shift: TodayModel['shift'], now: number, tz: string): string | null {
  if (!shift) return null;
  if (now < shift.start) return `Starts in ${formatDuration((shift.start - now) / 1000)}`;
  if (now < shift.end) return `${formatDuration((shift.end - now) / 1000)} left`;
  return `Ended at ${formatClock(shift.end, tz)}`;
}

interface TimeInstrumentProps {
  model: TodayModel;
  timezone: string;
}

/**
 * The page's reason to exist: state, the live clock inside the day's ring, and
 * beside it the actions and what is left (shift, break, today's make-up).
 *
 * This component re-renders every second with the clock; the ring is memoised
 * on minute-resolution props so it does not.
 */
export function TimeInstrument({ model, timezone }: TimeInstrumentProps) {
  const {
    displayState,
    elapsedSeconds,
    breakUsedSeconds,
    breakAllowanceSeconds,
    breakBlock,
    startTracking,
    pauseTracking,
    resumeFromPause,
    startBreak,
    endBreak,
    isLoading,
    isHydrating,
  } = useTimeTracking();
  const dayTotalSeconds = useDayTotal(timezone);

  const config = STATE_CONFIG[displayState];
  const active = displayState !== 'clocked-out';
  const breakRemaining = Math.max(0, breakAllowanceSeconds - breakUsedSeconds);

  const [hovered, setHovered] = useState<Segment | null>(null);
  const onHover = useCallback((seg: Segment | null) => setHovered(seg), []);

  const { shift, span, now, totals, segments } = model;
  const shiftLine = shiftStatus(shift, now, timezone);

  // One sentence for the ring image, at minute resolution — never per second,
  // or the memoised ring would re-render with the clock.
  const ringLabel = useMemo(() => {
    const counted = formatDuration(totals.working + totals.break);
    const parts = [`${config.label}. ${counted} counted today`];
    if (shift) {
      parts.push(`against a ${formatClock(shift.start, timezone)} to ${formatClock(shift.end, timezone)} shift`);
      if (shiftLine) parts.push(shiftLine.toLowerCase());
    }
    if (totals['not-counted'] > 0) parts.push(`${formatDuration(totals['not-counted'])} not counted`);
    return `${parts.join(', ')}.`;
  }, [config.label, totals, shift, shiftLine, timezone]);

  // Acting on a button unmounts it (the row is rendered per state), dropping
  // focus to <body>. Re-home it onto the action that replaced it — but only if
  // nothing else has claimed focus first.
  const actionRowRef = useRef<HTMLDivElement>(null);
  const didMountRef = useRef(false);
  useEffect(() => {
    if (!didMountRef.current) {
      didMountRef.current = true;
      return;
    }
    if (isLoading || isHydrating) return;
    if (document.activeElement && document.activeElement !== document.body) return;
    actionRowRef.current?.querySelector<HTMLButtonElement>('button:not([disabled])')?.focus();
  }, [displayState, isLoading, isHydrating]);

  const breakdown = SEGMENT_KINDS.filter(k => k === 'working' || totals[k] > 0);
  const emptyDay = !active && segments.length === 0 && !model.loading;

  return (
    <section aria-label="Clock" className={cn('@container rounded-xl p-6', SURFACE)}>
      <div className="flex flex-col items-center gap-8 @[38rem]:flex-row @[38rem]:items-center @[38rem]:gap-10">
        {/* ── The ring, with the state and the clock at its centre ── */}
        <div className="relative shrink-0 w-[300px] max-w-full aspect-square">
          <ShiftRing
            span={span}
            shift={shift}
            segments={segments}
            now={now}
            timezone={timezone}
            label={ringLabel}
            hovered={hovered}
            onHover={onHover}
          />
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center pb-2">
            {/* Announced on transition; the clock is deliberately outside this region. */}
            <div className="flex items-center gap-1.5" role="status">
              <config.Icon aria-hidden="true" className="size-4 shrink-0" style={{ color: config.color }} />
              <span className="text-sm font-medium" style={{ color: config.color }}>{config.label}</span>
            </div>
            <div
              className="mt-1 text-5xl font-bold tabular-nums tracking-tight"
              aria-live="off"
              style={{ opacity: displayState === 'on-break' ? 0.35 : 1, transition: 'opacity 120ms ease-out' }}
            >
              <span className="sr-only">Current session time: </span>
              {formatHms(elapsedSeconds)}
            </div>
            <div className="mt-2 h-4 text-xs text-zinc-400 tabular-nums" aria-hidden={hovered ? 'true' : undefined}>
              {hovered ? (
                <span className="inline-flex items-center gap-1.5 text-zinc-200">
                  <SegmentSwatch kind={hovered.kind} />
                  {SEGMENT_LABEL[hovered.kind]} · {formatClock(hovered.startMs, timezone)}–{formatClock(hovered.endMs, timezone)}
                  {' · '}{formatDuration((hovered.endMs - hovered.startMs) / 1000)}
                </span>
              ) : (
                <>Today {formatHms(dayTotalSeconds)}</>
              )}
            </div>
          </div>
        </div>

        {/* ── Actions and what is left ── */}
        <div className="w-full min-w-0 flex-1 flex flex-col gap-6">
          <div>
            <div ref={actionRowRef} className="flex flex-wrap items-center gap-3">
              {displayState === 'clocked-out' && (
                <Button onClick={startTracking} disabled={isLoading || isHydrating}>
                  {isHydrating ? 'Loading…' : isLoading ? 'Starting…' : 'Clock In'}
                </Button>
              )}

              {displayState === 'working' && (
                <>
                  <Button onClick={pauseTracking} disabled={isLoading} variant="outline">
                    <Pause aria-hidden="true" />
                    {isLoading ? 'Pausing…' : 'Pause'}
                  </Button>
                  {breakBlock ? (
                    // A disabled button takes no pointer events, so the
                    // focusable wrapper is what carries the tooltip.
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span tabIndex={0} className="inline-flex rounded-md" aria-label={`Break unavailable. ${BREAK_BLOCKED_TOOLTIP}`}>
                          <Button disabled variant="outline" tabIndex={-1} aria-hidden="true">
                            <Coffee aria-hidden="true" />
                            Break
                          </Button>
                        </span>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="max-w-[16rem]">{BREAK_BLOCKED_TOOLTIP}</TooltipContent>
                    </Tooltip>
                  ) : (
                    <Button onClick={startBreak} disabled={isLoading} variant="outline">
                      <Coffee aria-hidden="true" />
                      {isLoading ? 'Starting…' : 'Break'}
                    </Button>
                  )}
                </>
              )}

              {displayState === 'on-break' && (
                <Button onClick={endBreak} disabled={isLoading} variant="outline">
                  {isLoading ? 'Ending…' : 'End Break'}
                </Button>
              )}

              {displayState === 'paused' && (
                <Button onClick={resumeFromPause} disabled={isLoading}>
                  {isLoading ? 'Resuming…' : 'Resume'}
                </Button>
              )}

              {(displayState === 'working' || displayState === 'paused') && (
                <span className="@[38rem]:ml-auto">
                  <ClockOutButton />
                </span>
              )}
            </div>

            {displayState === 'idle' && (
              <p className="text-sm text-zinc-400">No activity detected. Timer will resume when you return.</p>
            )}
            {active && (
              <p className="mt-3 flex items-center gap-1.5 text-xs text-zinc-400">
                <Info aria-hidden="true" className="size-3.5 shrink-0" />
                You must explicitly clock out to save your time
              </p>
            )}
          </div>

          <dl className="flex flex-col divide-y divide-white/[0.07] border-y border-white/[0.07]">
            {shift && (
              <div className="flex items-baseline justify-between gap-4 py-3">
                <dt className="text-xs font-medium text-zinc-400">Shift</dt>
                <dd className="text-right">
                  <span className="text-sm font-medium tabular-nums">
                    {formatClock(shift.start, timezone)} – {formatClock(shift.end, timezone)}
                  </span>
                  <span className="block text-xs text-zinc-400 tabular-nums">
                    {shiftLine}
                    {active && breakBlock && (
                      breakBlock.reason === 'shift-start'
                        ? ` · Breaks open at ${formatClock(breakBlock.end, timezone)}`
                        : ' · No breaks in the last hour'
                    )}
                  </span>
                </dd>
              </div>
            )}

            {active && (
              <div className="flex items-baseline justify-between gap-4 py-3">
                <dt className="text-xs font-medium text-zinc-400">Break remaining</dt>
                <dd
                  className="text-2xl font-semibold tabular-nums"
                  style={{
                    color: displayState !== 'on-break'
                      ? '#a1a1aa'
                      : breakRemaining === 0
                        ? STATE_CONFIG['clocked-out'].color
                        : STATE_CONFIG['on-break'].color,
                    transition: 'color 120ms ease-out',
                  }}
                >
                  {formatHms(breakRemaining)}
                </dd>
              </div>
            )}

            <div className="py-3">
              <dt className="text-xs font-medium text-zinc-400">Today</dt>
              <dd className="mt-2">
                {emptyDay ? (
                  <p className="text-sm text-zinc-400">Nothing tracked yet today.</p>
                ) : (
                  <ul className="grid grid-cols-2 gap-x-6 gap-y-1.5 @[52rem]:grid-cols-3">
                    {breakdown.map((kind: SegmentKind) => (
                      <li key={kind} className="flex items-center justify-between gap-3 text-sm">
                        <span className="inline-flex items-center gap-2 text-zinc-300">
                          <SegmentSwatch kind={kind} />
                          {SEGMENT_LABEL[kind]}
                        </span>
                        <span className="tabular-nums">{formatDuration(totals[kind])}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </dd>
            </div>
          </dl>
        </div>
      </div>
    </section>
  );
}
