"use client";

import dynamic from "next/dynamic";
import AppLayout from "@/components/AppLayout";
import { useTimeTracking } from "@/hooks/useTimeTracking";
import type { TimerDisplayState } from "@/types/firestore";

const TodayTimeline = dynamic(
  () => import("@/components/timesheet/TodayTimeline"),
  { loading: () => <div style={{ minHeight: 200 }} /> }
);
const UserTimesheet = dynamic(
  () => import("@/components/timesheet/UserTimesheet"),
  { loading: () => <div style={{ minHeight: 200 }} /> }
);
const UserUpcomingShifts = dynamic(
  () => import("@/components/shifts/UserUpcomingShifts"),
  { loading: () => <div style={{ minHeight: 200 }} /> }
);
const UserScreenshots = dynamic(
  () => import("@/components/timesheet/UserScreenshots"),
  { loading: () => <div style={{ minHeight: 200 }} /> }
);
import { useUserData } from "@/hooks/useUserData";
import { useDayTotal } from "@/hooks/useDayTotal";
import { Clock4, ClockCheck, ClockAlert, Coffee, CirclePause } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

const STATE_CONFIG: Record<TimerDisplayState, { color: string; bgAlpha: string; label: string; Icon: React.ElementType }> = {
  working:       { color: '#86C27E', bgAlpha: 'rgba(134,194,126,0.1)', label: 'Working',     Icon: ClockCheck  },
  idle:          { color: '#E37836', bgAlpha: 'rgba(227,120,54,0.1)',  label: 'Idle',         Icon: ClockAlert  },
  'on-break':    { color: '#4B8FCC', bgAlpha: 'rgba(75,143,204,0.1)', label: 'On Break',     Icon: Coffee      },
  paused:        { color: '#8B5CF6', bgAlpha: 'rgba(139,92,246,0.1)', label: 'Paused',       Icon: CirclePause },
  'clocked-out': { color: '#DF626E', bgAlpha: 'rgba(223,98,110,0.1)', label: 'Clocked Out',  Icon: Clock4      },
};


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
  } = useTimeTracking();

  const { userData } = useUserData();
  const timezone = userData?.timezone || 'UTC';
  const dayTotalSeconds = useDayTotal(timezone);

  const config = STATE_CONFIG[displayState];

  const timerDisplay = formatTime(elapsedSeconds);

  const breakAllowanceRemaining = Math.max(0, breakAllowanceSeconds - breakUsedSeconds);

  return (
    <AppLayout>
      <div className="max-w-5xl">
        <h1 className="text-2xl font-bold tracking-tight mb-2">
          Time Tracking
        </h1>
        <p className="text-sm text-muted-foreground">
          Track your time and attendance
        </p>

        <div className="mt-12">
          <div
            className="rounded-lg p-8 flex items-start justify-between"
            style={{
              background: config.bgAlpha,
              border: '1px solid var(--border-subtle)',
            }}
          >
            {/* Left: state indicator + timer + buttons */}
            <div className="flex-1">
              {/* State indicator */}
              <div className="flex items-center gap-3 mb-1.5">
                <config.Icon style={{ color: config.color, width: '1.125rem', height: '1.125rem', flexShrink: 0 }} />
                <span className="text-lg font-medium" style={{ color: config.color }}>
                  {config.label}
                </span>
              </div>

              {/* Clock-out reminder */}
              {displayState !== 'clocked-out' ? (
                <div className="flex items-center gap-1.5 mb-6">
                  <span
                    className="flex items-center justify-center rounded-full text-[9px] font-bold leading-none flex-shrink-0"
                    style={{ width: '0.9rem', height: '0.9rem', border: '1px solid var(--foreground-muted)', color: 'var(--foreground-muted)' }}
                  >
                    i
                  </span>
                  <span className="text-xs" style={{ color: 'var(--foreground-muted)' }}>
                    You must explicitly clock out to save your time
                  </span>
                </div>
              ) : (
                <div className="mb-6" />
              )}

              {/* Timer display */}
              <div
                className="text-6xl font-mono font-bold"
                style={{
                  fontVariantNumeric: 'tabular-nums',
                  opacity: displayState === 'on-break' ? 0.35 : 1,
                  transition: 'opacity 0.2s ease',
                }}
              >
                {timerDisplay}
              </div>

              {/* Day total */}
              <div className="flex items-center gap-2 mt-2 mb-8">
                <span className="text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--foreground-muted)' }}>
                  Today
                </span>
                <span className="text-sm font-mono" style={{ color: 'var(--foreground-secondary)', fontVariantNumeric: 'tabular-nums' }}>
                  {formatTime(dayTotalSeconds)}
                </span>
              </div>

              {/* Action buttons */}
              <div className="flex gap-4 items-center">
                {displayState === 'clocked-out' && (
                  <Button
                    onClick={startTracking}
                    disabled={isLoading}
                  >
                    {isLoading ? 'Starting...' : 'Clock In'}
                  </Button>
                )}

                {displayState === 'working' && (
                  <>
                    <Button
                      onClick={pauseTracking}
                      disabled={isLoading}
                      style={{ background: '#8B5CF6', color: '#fff' }}
                    >
                      {isLoading ? 'Pausing...' : 'Pause'}
                    </Button>
                    <Button
                      onClick={startBreak}
                      disabled={isLoading}
                      variant="outline"
                    >
                      <Coffee style={{ width: '0.875rem', height: '0.875rem', flexShrink: 0 }} />
                      {isLoading ? 'Starting...' : 'Break'}
                    </Button>
                  </>
                )}

                {displayState === 'on-break' && (
                  <Button
                    onClick={endBreak}
                    disabled={isLoading}
                    variant="outline"
                  >
                    {isLoading ? 'Ending...' : 'End Break'}
                  </Button>
                )}

                {displayState === 'paused' && (
                  <Button
                    onClick={resumeFromPause}
                    disabled={isLoading}
                  >
                    {isLoading ? 'Resuming...' : 'Resume'}
                  </Button>
                )}

                {displayState === 'idle' && (
                  <p className="text-sm" style={{ color: 'var(--foreground-muted)' }}>
                    No activity detected. Timer will resume when you return.
                  </p>
                )}
              </div>
            </div>

            {/* Right: break allowance remaining + clock out (only when session is active) */}
            {displayState !== 'clocked-out' && (
              <div className="flex flex-col items-end gap-4 ml-8 flex-shrink-0">
                <div className="flex flex-col items-end gap-1">
                  <span
                    className="text-xs font-medium uppercase tracking-wide"
                    style={{ color: 'var(--foreground-muted)' }}
                  >
                    Break Remaining
                  </span>
                  <span
                    className="text-2xl font-mono font-semibold"
                    style={{
                      color: displayState !== 'on-break'
                        ? 'var(--foreground-muted)'
                        : breakAllowanceRemaining === 0 ? '#DF626E' : '#4B8FCC',
                      opacity: displayState !== 'on-break' ? 0.5 : 1,
                      transition: 'color 0.2s ease, opacity 0.2s ease',
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
                    {isLoading ? 'Stopping...' : 'Clock Out'}
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Tabbed container */}
        <Tabs defaultValue="today" className="mt-8">
          <TabsList>
            <TabsTrigger value="today">Today's Timesheet</TabsTrigger>
            <TabsTrigger value="previous">Previous Timesheets</TabsTrigger>
            <TabsTrigger value="upcoming">Upcoming Shifts</TabsTrigger>
            <TabsTrigger value="screenshots">Screenshots</TabsTrigger>
          </TabsList>
          <TabsContent value="today" className="mt-4"><TodayTimeline /></TabsContent>
          <TabsContent value="previous" className="mt-4"><UserTimesheet /></TabsContent>
          <TabsContent value="upcoming" className="mt-4"><UserUpcomingShifts /></TabsContent>
          <TabsContent value="screenshots" className="mt-4"><UserScreenshots /></TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}
