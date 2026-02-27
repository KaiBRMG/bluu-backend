"use client";

import { useEffect, useState } from "react";
import AppLayout from "@/components/AppLayout";
import { useAuth } from "@/components/AuthProvider";
import { useUserData } from "@/hooks/useUserData";
import { useTimeTracking } from "@/hooks/useTimeTracking";
import type { TimerDisplayState } from "@/types/firestore";
import { Clock4, ClockCheck, ClockAlert, Coffee, CirclePause } from 'lucide-react';

const STATE_CONFIG: Record<TimerDisplayState, { color: string; bgAlpha: string; label: string; Icon: React.ElementType }> = {
  working:       { color: '#86C27E', bgAlpha: 'rgba(134,194,126,0.1)', label: 'Working',    Icon: ClockCheck  },
  idle:          { color: '#E37836', bgAlpha: 'rgba(227,120,54,0.1)',  label: 'Idle',        Icon: ClockAlert  },
  'on-break':    { color: '#4B8FCC', bgAlpha: 'rgba(75,143,204,0.1)', label: 'On Break',    Icon: Coffee      },
  paused:        { color: '#8B5CF6', bgAlpha: 'rgba(139,92,246,0.1)', label: 'Paused',      Icon: CirclePause },
  'clocked-out': { color: '#DF626E', bgAlpha: 'rgba(223,98,110,0.1)', label: 'Clocked Out', Icon: Clock4      },
};

function formatTime(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function formatClockTime(tz: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date());
}

function shortTzLabel(tz: string): string {
  const city = tz.split('/').pop()?.replace(/_/g, ' ') ?? tz;
  const formatter = new Intl.DateTimeFormat('en-GB', { timeZone: tz, timeZoneName: 'shortOffset' });
  const gmtPart = formatter.formatToParts(new Date()).find(p => p.type === 'timeZoneName')?.value ?? '';
  // Normalise "GMT+2" → "GMT+2", already correct
  return `${city} ${gmtPart}`;
}

const DEFAULT_ADDITIONAL_TZS = ['Africa/Johannesburg', 'Asia/Manila'];

function tzOffsetMinutes(tz: string): number {
  const now = new Date();
  const utcMs = now.getTime();
  const localMs = new Date(now.toLocaleString('en-US', { timeZone: tz })).getTime();
  return Math.round((localMs - utcMs) / 60000);
}

function ClockWidget() {
  const { userData } = useUserData();
  const primaryTz = userData?.timezone ?? '';

  // additionalTimezones absent (undefined) = use defaults; [] = user explicitly cleared
  const storedAdditional = userData?.additionalTimezones;
  const primaryOffsetMin = primaryTz ? tzOffsetMinutes(primaryTz) : null;
  const effectiveAdditional = storedAdditional !== undefined
    ? storedAdditional
    : DEFAULT_ADDITIONAL_TZS.filter(
        tz => primaryOffsetMin === null || tzOffsetMinutes(tz) !== primaryOffsetMin
      );

  const allTzs = primaryTz ? [primaryTz, ...effectiveAdditional] : [];

  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 10_000);
    return () => clearInterval(id);
  }, []);

  return (
    <div
      className="rounded-lg p-6"
      style={{ background: '#000000' }}
    >
      {allTzs.length === 0 ? (
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-mono font-semibold" style={{ fontVariantNumeric: 'tabular-nums' }}>
            --:--
          </span>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {allTzs.map((tz) => (
            <div key={tz} className="flex items-baseline gap-2">
              <span
                className="text-2xl font-mono font-semibold"
                style={{ fontVariantNumeric: 'tabular-nums' }}
              >
                {formatClockTime(tz)}
              </span>
              <span
                className="text-sm"
                style={{ color: 'var(--foreground-secondary)' }}
              >
                {shortTzLabel(tz)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TimeTrackingWidget() {
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
  const isOnBreak = displayState === 'on-break';
  const timerSeconds = isOnBreak && breakRemainingSeconds !== null ? breakRemainingSeconds : elapsedSeconds;

  return (
    <div
      className="rounded-lg p-6 transition-colors"
      style={{
        background: config.bgAlpha,
      }}
    >
      {/* State indicator */}
      <div className="flex items-center gap-2 mb-3">
        <config.Icon style={{ color: config.color, width: '0.875rem', height: '0.875rem', flexShrink: 0 }} />
        <span className="text-xs font-medium uppercase tracking-wide" style={{ color: config.color }}>
          {config.label}
        </span>
      </div>

      {/* Timer */}
      <p
        className="text-2xl font-mono font-semibold mb-4"
        style={{
          fontVariantNumeric: 'tabular-nums',
          color: isOnBreak ? '#4B8FCC' : undefined,
          transition: 'color 0.2s ease',
        }}
      >
        {formatTime(timerSeconds)}
      </p>

      {/* Actions */}
      <div className="flex flex-wrap gap-2">
        {displayState === 'clocked-out' && (
          <button
            onClick={startTracking}
            disabled={isLoading}
            className="btn-primary text-sm"
            style={{ opacity: isLoading ? 0.6 : 1 }}
          >
            {isLoading ? 'Starting...' : 'Clock In'}
          </button>
        )}

        {displayState === 'working' && (
          <>
            <button
              onClick={startBreak}
              disabled={isLoading}
              className="btn-secondary flex items-center gap-1.5 text-sm"
              style={{ opacity: isLoading ? 0.6 : 1 }}
            >
              <Coffee style={{ width: '0.75rem', height: '0.75rem', flexShrink: 0 }} />
              {isLoading ? 'Starting...' : 'Break'}
            </button>
            <button
              onClick={stopTracking}
              disabled={isLoading}
              className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
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

        {displayState === 'on-break' && (
          <button
            onClick={endBreak}
            disabled={isLoading}
            className="btn-secondary text-sm"
            style={{ opacity: isLoading ? 0.6 : 1 }}
          >
            {isLoading ? 'Ending...' : 'End Break'}
          </button>
        )}
      </div>
    </div>
  );
}

export default function Home() {
  const { user } = useAuth();
  const { userData } = useUserData();
  const firstName = user?.displayName?.split(' ')[0] || 'User';

  // Get the first group from the user's groups array, or default to "General"
  const userGroup = userData?.groups?.[0] || "unassigned";
  const displayGroup = userGroup.charAt(0).toUpperCase() + userGroup.slice(1);

  const showTimeTracking = userData?.timeTracking === true;

  return (
    <AppLayout>
      <div className="max-w-5xl">
        <h1 className="text-5xl font-bold mb-2 tracking-tight">
          Welcome, {firstName}
        </h1>
        <p className="text-lg" style={{ color: 'var(--foreground-secondary)' }}>
          Your personalized workspace
        </p>

        {/* Quick stats or widgets can go here */}
        <div className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-6">
          <div
            className="rounded-lg p-6"
            style={{
              background: 'var(--sidebar-background)',
            }}
          >
            <h3 className="text-sm uppercase tracking-wide mb-2" style={{ color: 'var(--foreground-secondary)' }}>Team</h3>
            <p className="text-2xl font-semibold">{displayGroup}</p>
          </div>

          {showTimeTracking ? (
            <TimeTrackingWidget />
          ) : (
            <div
              className="rounded-lg p-6 transition-colors"
              style={{
                background: 'var(--sidebar-background)',
                border: '1px solid var(--border-subtle)'
              }}
              onMouseEnter={(e) => e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.15)'}
              onMouseLeave={(e) => e.currentTarget.style.borderColor = 'var(--border-subtle)'}
            >
              <h3 className="text-sm uppercase tracking-wide mb-2" style={{ color: 'var(--foreground-secondary)' }}>Active Projects</h3>
              <p className="text-2xl font-semibold">5</p>
            </div>
          )}

          <ClockWidget />
        </div>
      </div>
    </AppLayout>
  );
}
