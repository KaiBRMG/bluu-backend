"use client";

import AppLayout from "@/components/AppLayout";
import { useTimeTracking } from "@/hooks/useTimeTracking";
import UserTimesheet from "@/components/timesheet/UserTimesheet";
import type { TimerDisplayState } from "@/types/firestore";

const STATE_CONFIG: Record<TimerDisplayState, { color: string; bgAlpha: string; label: string }> = {
  working: { color: '#22c55e', bgAlpha: 'rgba(34,197,94,0.1)', label: 'Working' },
  idle: { color: '#f59e0b', bgAlpha: 'rgba(245,158,11,0.1)', label: 'Idle' },
  'on-break': { color: '#8b5cf6', bgAlpha: 'rgba(139,92,246,0.1)', label: 'On Break' },
  'clocked-out': { color: 'var(--foreground-muted)', bgAlpha: 'var(--sidebar-background)', label: 'Clocked Out' },
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
    breakRemainingSeconds,
    startTracking,
    stopTracking,
    startBreak,
    endBreak,
    isLoading,
  } = useTimeTracking();

  const config = STATE_CONFIG[displayState];

  const timerDisplay = displayState === 'on-break'
    ? formatTime(breakRemainingSeconds ?? 0)
    : formatTime(elapsedSeconds);

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
            className="rounded-lg p-8"
            style={{
              background: config.bgAlpha,
              border: '1px solid var(--border-subtle)',
            }}
          >
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
              {displayState === 'on-break' && breakRemainingSeconds !== null && (
                <span className="text-sm" style={{ color: 'var(--foreground-secondary)' }}>
                  — {formatTime(breakRemainingSeconds)} remaining
                </span>
              )}
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
                    {isLoading ? 'Stopping...' : 'Stop'}
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
                  {isLoading ? 'Ending...' : 'End Break Early'}
                </button>
              )}

              {displayState === 'idle' && (
                <p className="text-sm" style={{ color: 'var(--foreground-muted)' }}>
                  No activity detected. Timer will resume when you return.
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="mt-8">
          <UserTimesheet />
        </div>
      </div>
    </AppLayout>
  );
}
