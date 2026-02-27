"use client";

import { useState } from 'react';
import AppLayout from "@/components/AppLayout";
import { useTimeTracking } from "@/hooks/useTimeTracking";
import UserTimesheet from "@/components/timesheet/UserTimesheet";
import TodayTimeline from "@/components/timesheet/TodayTimeline";
import type { TimerDisplayState } from "@/types/firestore";
import UserUpcomingShifts from "@/components/shifts/UserUpcomingShifts";

const STATE_CONFIG: Record<TimerDisplayState, { color: string; bgAlpha: string; label: string }> = {
  working:      { color: '#86C27E', bgAlpha: 'rgba(134,194,126,0.1)', label: 'Working' },
  idle:         { color: '#E37836', bgAlpha: 'rgba(227,120,54,0.1)', label: 'Idle' },
  'on-break':   { color: '#4B8FCC', bgAlpha: 'rgba(75,143,204,0.1)', label: 'On Break' },
  paused:       { color: '#8B5CF6', bgAlpha: 'rgba(139,92,246,0.1)', label: 'Paused' },
  'clocked-out': { color: '#DF626E', bgAlpha: 'rgba(223,98,110,0.1)', label: 'Clocked Out' },
};

const BREAK_DURATION_SECONDS = 2700;

const TAB_LABELS = {
  today: "Today's Timesheet",
  previous: 'Previous Timesheets',
  upcoming: 'Upcoming Shifts',
} as const;

type Tab = keyof typeof TAB_LABELS;

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
    startTracking,
    stopTracking,
    pauseTracking,
    resumeFromPause,
    startBreak,
    endBreak,
    isLoading,
  } = useTimeTracking();

  const [activeTab, setActiveTab] = useState<Tab>('today');

  const config = STATE_CONFIG[displayState];

  const timerDisplay = formatTime(elapsedSeconds);

  const breakAllowanceRemaining = Math.max(0, BREAK_DURATION_SECONDS - breakUsedSeconds);

  return (
    <AppLayout>
      <div className="max-w-5xl">
        <h1 className="text-5xl font-bold mb-2 tracking-tight">
          Time Tracking
        </h1>
        <p className="text-lg" style={{ color: 'var(--foreground-secondary)' }}>
          Track your time and productivity
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
                <div
                  className="w-3 h-3 rounded-full"
                  style={{
                    background: config.color,
                    boxShadow: displayState === 'working' ? `0 0 8px ${config.color}` : 'none',
                  }}
                />
                <span className="text-lg font-medium" style={{ color: config.color }}>
                  {config.label}
                </span>
              </div>

              {/* Timer display */}
              <div
                className="text-6xl font-mono font-bold mb-8"
                style={{ fontVariantNumeric: 'tabular-nums' }}
              >
                {timerDisplay}
              </div>

              {/* Action buttons */}
              <div className="flex gap-4 items-center">
                {displayState === 'clocked-out' && (
                  <button
                    onClick={startTracking}
                    disabled={isLoading}
                    className="btn-primary"
                    style={{ opacity: isLoading ? 0.6 : 1 }}
                  >
                    {isLoading ? 'Starting...' : 'Start Tracking'}
                  </button>
                )}

                {displayState === 'working' && (
                  <>
                    <button
                      onClick={stopTracking}
                      disabled={isLoading}
                      className="px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                      style={{
                        background: '#ef4444',
                        color: '#fff',
                        opacity: isLoading ? 0.6 : 1,
                      }}
                    >
                      {isLoading ? 'Stopping...' : 'Clock Out'}
                    </button>
                    <button
                      onClick={pauseTracking}
                      disabled={isLoading}
                      className="px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                      style={{
                        background: '#8B5CF6',
                        color: '#fff',
                        opacity: isLoading ? 0.6 : 1,
                      }}
                    >
                      {isLoading ? 'Pausing...' : 'Pause'}
                    </button>
                    <button
                      onClick={startBreak}
                      disabled={isLoading}
                      className="btn-secondary"
                      style={{ opacity: isLoading ? 0.6 : 1 }}
                    >
                      {isLoading ? 'Starting...' : 'Take Break'}
                    </button>
                  </>
                )}

                {displayState === 'on-break' && (
                  <button
                    onClick={endBreak}
                    disabled={isLoading}
                    className="btn-secondary"
                    style={{ opacity: isLoading ? 0.6 : 1 }}
                  >
                    {isLoading ? 'Ending...' : 'End Break'}
                  </button>
                )}

                {displayState === 'paused' && (
                  <>
                    <button
                      onClick={resumeFromPause}
                      disabled={isLoading}
                      className="btn-primary"
                      style={{ opacity: isLoading ? 0.6 : 1 }}
                    >
                      {isLoading ? 'Resuming...' : 'Resume'}
                    </button>
                    <button
                      onClick={stopTracking}
                      disabled={isLoading}
                      className="px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                      style={{
                        background: '#ef4444',
                        color: '#fff',
                        opacity: isLoading ? 0.6 : 1,
                      }}
                    >
                      {isLoading ? 'Stopping...' : 'Clock Out'}
                    </button>
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
                  style={{ color: breakAllowanceRemaining === 0 ? '#DF626E' : '#4B8FCC' }}
                >
                  {formatTime(breakAllowanceRemaining)}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Tabbed container */}
        <div className="mt-8">
          <div
            className="flex border-b"
            style={{ borderColor: 'var(--border-subtle)' }}
          >
            {(Object.keys(TAB_LABELS) as Tab[]).map((key) => (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                className="px-4 py-2.5 text-sm font-medium transition-colors"
                style={{
                  color: activeTab === key ? 'var(--foreground)' : 'var(--foreground-muted)',
                  borderBottom: activeTab === key ? '2px solid var(--foreground)' : '2px solid transparent',
                  marginBottom: '-1px',
                }}
              >
                {TAB_LABELS[key]}
              </button>
            ))}
          </div>

          <div className="mt-4">
            {activeTab === 'today' && <TodayTimeline />}
            {activeTab === 'previous' && <UserTimesheet />}
            {activeTab === 'upcoming' && <UserUpcomingShifts />}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
