"use client";

import AppLayout from "@/components/AppLayout";
import { useTimeTracking } from "@/hooks/useTimeTracking";
import UserTimesheet from "@/components/timesheet/UserTimesheet";
import TodayTimeline from "@/components/timesheet/TodayTimeline";
import type { TimerDisplayState } from "@/types/firestore";
import UserUpcomingShifts from "@/components/shifts/UserUpcomingShifts";
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
  const includeIdleTime = userData?.includeIdleTime ?? false;
  const dayTotalSeconds = useDayTotal(timezone, includeIdleTime);

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
              <div className="flex items-center gap-3 mb-6">
                <config.Icon style={{ color: config.color, width: '1.125rem', height: '1.125rem', flexShrink: 0 }} />
                <span className="text-lg font-medium" style={{ color: config.color }}>
                  {config.label}
                </span>
              </div>

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
                      onClick={stopTracking}
                      disabled={isLoading}
                      variant="destructive"
                    >
                      {isLoading ? 'Stopping...' : 'Clock Out'}
                    </Button>
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
                  <>
                    <Button
                      onClick={resumeFromPause}
                      disabled={isLoading}
                    >
                      {isLoading ? 'Resuming...' : 'Resume'}
                    </Button>
                    <Button
                      onClick={stopTracking}
                      disabled={isLoading}
                      variant="destructive"
                    >
                      {isLoading ? 'Stopping...' : 'Clock Out'}
                    </Button>
                  </>
                )}

                {displayState === 'idle' && (
                  <p className="text-sm" style={{ color: 'var(--foreground-muted)' }}>
                    No activity detected. Timer will resume when you return.
                  </p>
                )}
              </div>
            </div>

            {/* Right: break allowance remaining (only when session is active) */}
            {displayState !== 'clocked-out' && (
              <div className="flex flex-col items-end gap-1 ml-8 flex-shrink-0">
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
            )}
          </div>
        </div>

        {/* Tabbed container */}
        <Tabs defaultValue="today" className="mt-8">
          <TabsList variant="line">
            <TabsTrigger value="today">Today's Timesheet</TabsTrigger>
            <TabsTrigger value="previous">Previous Timesheets</TabsTrigger>
            <TabsTrigger value="upcoming">Upcoming Shifts</TabsTrigger>
          </TabsList>
          <TabsContent value="today" className="mt-4"><TodayTimeline /></TabsContent>
          <TabsContent value="previous" className="mt-4"><UserTimesheet /></TabsContent>
          <TabsContent value="upcoming" className="mt-4"><UserUpcomingShifts /></TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}
