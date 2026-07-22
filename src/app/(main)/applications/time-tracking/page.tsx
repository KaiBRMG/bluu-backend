"use client";

import dynamic from "next/dynamic";
import { memo, useEffect, useRef } from "react";
import AppLayout from "@/components/AppLayout";
import { useTimeTracking } from "@/hooks/useTimeTracking";
import { useUserData } from "@/hooks/useUserData";
import { useDayTotal } from "@/hooks/useDayTotal";
import { Coffee, Info, Pause } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { STATE_CONFIG } from "@/lib/stateColors";

/* ── Loading skeletons ───────────────────────────────────────────────
   Shaped to each tab's final layout (DESIGN.md § Loading & Empty States).
   A bare min-height box reads as an empty tab; these read as pending data. */

function PanelSkeleton({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="rounded-lg p-6"
      style={{
        background: "var(--container-background)",
        border: "1px solid var(--border-subtle)",
      }}
    >
      {children}
    </div>
  );
}

function TimelineSkeleton() {
  return (
    <PanelSkeleton>
      <div className="flex items-baseline gap-3 mb-5">
        <Skeleton className="h-6 w-44" />
        <Skeleton className="h-3 w-28" />
      </div>
      <div className="flex justify-between mb-2">
        {Array.from({ length: 7 }).map((_, i) => (
          <Skeleton key={i} className="h-3 w-9" />
        ))}
      </div>
      <div className="space-y-2">
        <Skeleton className="h-8 w-full rounded-md" />
        <Skeleton className="h-8 w-full rounded-md" />
      </div>
    </PanelSkeleton>
  );
}

function TimesheetSkeleton() {
  return (
    <PanelSkeleton>
      <div className="flex items-center justify-between mb-5">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-8 w-32 rounded-md" />
      </div>
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full rounded-md" />
        ))}
      </div>
    </PanelSkeleton>
  );
}

function ShiftsSkeleton() {
  return (
    <PanelSkeleton>
      <div className="flex items-center justify-between mb-5">
        <Skeleton className="h-6 w-56" />
        <Skeleton className="h-8 w-24 rounded-md" />
      </div>
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-14 w-full rounded-md" />
        ))}
      </div>
    </PanelSkeleton>
  );
}

function ScreenshotsSkeleton() {
  return (
    <PanelSkeleton>
      <div className="flex items-center justify-between mb-5">
        <Skeleton className="h-6 w-36" />
        <Skeleton className="h-8 w-40 rounded-md" />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="aspect-video w-full rounded-md" />
        ))}
      </div>
    </PanelSkeleton>
  );
}

/* Tab bodies are memoised: the timer ticks once a second, which re-renders this
   page, and without memo that tick cascades into whichever tab is mounted.
   They take no props, so memo bails out every time. (TodayTimeline subscribes to
   the time-tracking context itself and runs its own 1s tick for live segments —
   that one is by design and memo does not, and should not, suppress it.) */

const TodayTimeline = memo(
  dynamic(() => import("@/components/timesheet/TodayTimeline"), {
    loading: TimelineSkeleton,
  })
);
const UserTimesheet = memo(
  dynamic(() => import("@/components/timesheet/UserTimesheet"), {
    loading: TimesheetSkeleton,
  })
);
const UserUpcomingShifts = memo(
  dynamic(() => import("@/components/shifts/UserUpcomingShifts"), {
    loading: ShiftsSkeleton,
  })
);
const UserScreenshots = memo(
  dynamic(() => import("@/components/timesheet/UserScreenshots"), {
    loading: ScreenshotsSkeleton,
  })
);

function formatTime(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export default function TimeTrackingPage() {
  const {
    displayState,
    elapsedSeconds,
    breakUsedSeconds,
    breakAllowanceSeconds,
    startTracking,
    stopTracking,
    pauseTracking,
    resumeFromPause,
    startBreak,
    endBreak,
    isLoading,
    isHydrating,
  } = useTimeTracking();

  const { userData } = useUserData();
  const timezone = userData?.timezone || 'UTC';
  const dayTotalSeconds = useDayTotal(timezone);

  const config = STATE_CONFIG[displayState];

  const timerDisplay = formatTime(elapsedSeconds);

  const breakAllowanceRemaining = Math.max(0, breakAllowanceSeconds - breakUsedSeconds);

  // Each action button is conditionally rendered on displayState, so acting on one
  // unmounts the element that has focus and drops it to <body>. Re-home focus onto
  // the action that replaced it, but only if nothing else has claimed focus first.
  const actionRowRef = useRef<HTMLDivElement>(null);
  const didMountRef = useRef(false);

  useEffect(() => {
    if (!didMountRef.current) {
      didMountRef.current = true;
      return;
    }
    if (isLoading || isHydrating) return;
    // Focus is only orphaned if it fell back to the body — never steal it otherwise.
    if (document.activeElement && document.activeElement !== document.body) return;
    actionRowRef.current
      ?.querySelector<HTMLButtonElement>("button:not([disabled])")
      ?.focus();
  }, [displayState, isLoading, isHydrating]);

  return (
    <AppLayout>
      <div className="w-full max-w-5xl">
        <h1 className="text-2xl font-bold tracking-tight mb-2">
          Time Tracking
        </h1>
        <p className="text-sm text-muted-foreground">
          Track your time and attendance
        </p>

        <div className="mt-12">
          <div
            className="rounded-lg p-6 sm:p-8 flex flex-col lg:flex-row lg:items-start lg:justify-between"
            style={{
              background: config.bgAlpha,
              border: '1px solid var(--border-subtle)',
            }}
          >
            {/* Left: state indicator + timer + buttons */}
            <div className="flex-1 min-w-0">
              {/* State indicator — announced on transition so acting on a button
                  gives non-visual confirmation. The timer is deliberately NOT in
                  this region; a per-second live region is unusable. */}
              <div className="flex items-center gap-3 mb-1.5" role="status">
                <config.Icon
                  aria-hidden="true"
                  style={{ color: config.color, width: '1.125rem', height: '1.125rem', flexShrink: 0 }}
                />
                <span className="text-lg font-medium" style={{ color: config.color }}>
                  {config.label}
                </span>
              </div>

              {/* Clock-out reminder. The row keeps its box in both states so the
                  timer and buttons below don't jump when a session opens/closes. */}
              <div className="flex items-center gap-1.5 mb-6 h-[1.125rem]">
                {displayState !== 'clocked-out' && (
                  <>
                    <Info
                      aria-hidden="true"
                      className="flex-shrink-0"
                      style={{ width: '0.9rem', height: '0.9rem', color: 'var(--foreground-secondary)' }}
                    />
                    <span className="text-xs" style={{ color: 'var(--foreground-secondary)' }}>
                      You must explicitly clock out to save your time
                    </span>
                  </>
                )}
              </div>

              {/* Timer display */}
              <div
                className="text-5xl sm:text-6xl font-mono font-bold"
                aria-live="off"
                style={{
                  fontVariantNumeric: 'tabular-nums',
                  opacity: displayState === 'on-break' ? 0.35 : 1,
                  transition: 'opacity 120ms ease-out',
                }}
              >
                <span className="sr-only">Current session time: </span>
                {timerDisplay}
              </div>

              {/* Day total */}
              <div className="flex items-center gap-2 mt-2 mb-8">
                <span className="text-xs font-medium" style={{ color: 'var(--foreground-secondary)' }}>
                  Today
                </span>
                <span className="text-sm font-mono" style={{ color: 'var(--foreground-secondary)', fontVariantNumeric: 'tabular-nums' }}>
                  {formatTime(dayTotalSeconds)}
                </span>
              </div>

              {/* Action buttons */}
              <div ref={actionRowRef} className="flex flex-wrap gap-4 items-center">
                {displayState === 'clocked-out' && (
                  <Button
                    onClick={startTracking}
                    disabled={isLoading || isHydrating}
                  >
                    {isHydrating ? 'Loading…' : isLoading ? 'Starting…' : 'Clock In'}
                  </Button>
                )}

                {displayState === 'working' && (
                  <>
                    <Button
                      onClick={pauseTracking}
                      disabled={isLoading}
                      variant="outline"
                    >
                      <Pause aria-hidden="true" style={{ width: '0.875rem', height: '0.875rem', flexShrink: 0 }} />
                      {isLoading ? 'Pausing…' : 'Pause'}
                    </Button>
                    <Button
                      onClick={startBreak}
                      disabled={isLoading}
                      variant="outline"
                    >
                      <Coffee aria-hidden="true" style={{ width: '0.875rem', height: '0.875rem', flexShrink: 0 }} />
                      {isLoading ? 'Starting…' : 'Break'}
                    </Button>
                  </>
                )}

                {displayState === 'on-break' && (
                  <Button
                    onClick={endBreak}
                    disabled={isLoading}
                    variant="outline"
                  >
                    {isLoading ? 'Ending…' : 'End Break'}
                  </Button>
                )}

                {displayState === 'paused' && (
                  <Button
                    onClick={resumeFromPause}
                    disabled={isLoading}
                  >
                    {isLoading ? 'Resuming…' : 'Resume'}
                  </Button>
                )}

                {displayState === 'idle' && (
                  <p className="text-sm" style={{ color: 'var(--foreground-secondary)' }}>
                    No activity detected. Timer will resume when you return.
                  </p>
                )}
              </div>
            </div>

            {/* Right: break allowance remaining + clock out (only when session is active) */}
            {displayState !== 'clocked-out' && (
              <div className="flex flex-row items-center justify-between gap-4 mt-6 pt-6 border-t lg:mt-0 lg:pt-0 lg:border-t-0 lg:flex-col lg:items-end lg:ml-8 lg:flex-shrink-0"
                   style={{ borderColor: 'var(--border-subtle)' }}>
                <div className="flex flex-col gap-1 lg:items-end">
                  <span
                    className="text-xs font-medium"
                    style={{ color: 'var(--foreground-secondary)' }}
                  >
                    Break Remaining
                  </span>
                  <span
                    className="text-2xl font-mono font-semibold"
                    style={{
                      color: displayState !== 'on-break'
                        ? 'var(--foreground-secondary)'
                        : breakAllowanceRemaining === 0
                          ? STATE_CONFIG['clocked-out'].color
                          : STATE_CONFIG['on-break'].color,
                      fontVariantNumeric: 'tabular-nums',
                      transition: 'color 120ms ease-out',
                    }}
                  >
                    {formatTime(breakAllowanceRemaining)}
                  </span>
                </div>
                {(displayState === 'working' || displayState === 'paused') && (
                  <Button
                    onClick={stopTracking}
                    disabled={isLoading}
                    variant="destructive"
                  >
                    {isLoading ? 'Stopping…' : 'Clock Out'}
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Tabbed container */}
        <Tabs defaultValue="today" className="mt-8">
          <div className="overflow-x-auto">
            <TabsList>
              <TabsTrigger value="today">Today&apos;s Timesheet</TabsTrigger>
              <TabsTrigger value="previous">Previous Timesheets</TabsTrigger>
              <TabsTrigger value="upcoming">Upcoming Shifts</TabsTrigger>
              <TabsTrigger value="screenshots">Screenshots</TabsTrigger>
            </TabsList>
          </div>
          <TabsContent value="today" className="mt-4"><TodayTimeline /></TabsContent>
          <TabsContent value="previous" className="mt-4"><UserTimesheet /></TabsContent>
          <TabsContent value="upcoming" className="mt-4"><UserUpcomingShifts /></TabsContent>
          <TabsContent value="screenshots" className="mt-4"><UserScreenshots /></TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}
