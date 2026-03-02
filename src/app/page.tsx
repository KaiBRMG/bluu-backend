"use client";

import { useEffect, useRef, useState } from "react";
import AppLayout from "@/components/AppLayout";
import { useAuth } from "@/components/AuthProvider";
import { useUserData } from "@/hooks/useUserData";
import { useTimeTracking } from "@/hooks/useTimeTracking";
import { useNotifications } from "@/hooks/useNotifications";
import type { NotificationDocument, NotificationType, TimerDisplayState } from "@/types/firestore";
import { Clock4, ClockCheck, ClockAlert, Coffee, CirclePause } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

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

// ─── Announcement helpers ────────────────────────────────────────────

const TYPE_ANNOUNCEMENT_COLOR: Record<NotificationType, { color: string; bg: string }> = {
  shift:      { color: '#3b82f6', bg: 'rgba(59,130,246,0.1)'  },
  alert:      { color: '#ef4444', bg: 'rgba(239,68,68,0.1)'   },
  success:    { color: '#22c55e', bg: 'rgba(34,197,94,0.1)'   },
  action:     { color: '#eab308', bg: 'rgba(234,179,8,0.1)'   },
  onboarding: { color: 'var(--foreground-muted)', bg: 'var(--sidebar-background)' },
  system:     { color: 'var(--foreground-muted)', bg: 'var(--sidebar-background)' },
};

function formatAnnouncementDate(ts: import('@/types/firestore').NotificationDocument['createdAt']): string {
  if (!ts) return '';
  const d = ts.toDate();
  return d.toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

function AnnouncementBanner({ announcements }: { announcements: NotificationDocument[] }) {
  const { user } = useAuth();
  // Track IDs we've already fired mark-read for this session
  const markedRef = useRef<Set<string>>(new Set());
  // Track IDs we've already fired dismiss for this session
  const dismissedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!user || announcements.length === 0) return;

    async function getIdToken() {
      if (!user) return null;
      return user.getIdToken();
    }

    for (const ann of announcements) {
      // Mark as read on first display
      if (!ann.read && !markedRef.current.has(ann.id)) {
        markedRef.current.add(ann.id);
        getIdToken().then((token) => {
          if (!token) return;
          fetch('/api/notifications/mark-read', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ notificationId: ann.id }),
          }).catch(() => {});
        });
      }

      // Auto-dismiss if past expiry
      if (
        ann.announcementExpiry &&
        ann.announcementExpiry.toMillis() <= Date.now() &&
        !dismissedRef.current.has(ann.id)
      ) {
        dismissedRef.current.add(ann.id);
        getIdToken().then((token) => {
          if (!token) return;
          fetch('/api/notifications/dismiss', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ notificationId: ann.id }),
          }).catch(() => {});
        });
      }
    }
  }, [announcements, user]);

  if (announcements.length === 0) return null;

  // Colour the block by the most recent announcement's type
  const mostRecent = announcements[0];
  const { color, bg } = TYPE_ANNOUNCEMENT_COLOR[mostRecent.type] ?? TYPE_ANNOUNCEMENT_COLOR.system;

  return (
    <div
      className="rounded-lg p-6 mb-8"
      style={{ background: bg }}
    >
      <div className="flex flex-col gap-4">
        {announcements.map((ann) => {
          const stripe = TYPE_ANNOUNCEMENT_COLOR[ann.type]?.color ?? 'var(--foreground-muted)';
          return (
            <div key={ann.id} className="flex items-stretch gap-4">
              {/* Type stripe */}
              <div
                className="flex-shrink-0 w-1 rounded-full self-stretch"
                style={{ background: stripe }}
              />
              <div className="flex-1 min-w-0">
                <p
                  className="text-sm font-semibold leading-snug"
                  style={{ color }}
                >
                  {ann.title}
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    — {formatAnnouncementDate(ann.createdAt)}
                  </span>
                </p>
                <p className="text-sm mt-1 text-muted-foreground">
                  {ann.message}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
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
    <Card style={{ background: '#171717' }} className="border-0 shadow-none py-0 gap-0">
      <CardContent className="p-6">
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
                <span className="text-sm text-muted-foreground">
                  {shortTzLabel(tz)}
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
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
    <Card className="border-0 shadow-none transition-colors py-0 gap-0" style={{ background: config.bgAlpha }}>
      <CardContent className="p-6">
        {/* State indicator */}
        <div className="flex items-center gap-2 mb-3">
          <config.Icon style={{ color: config.color, width: '0.875rem', height: '0.875rem', flexShrink: 0 }} />
          <span className="text-xs font-medium uppercase tracking-wide" style={{ color: config.color }}>
            {config.label}
          </span>
        </div>

        {/* Timer + Actions */}
        <div className="flex items-center justify-between gap-4">
          <p
            className="text-2xl font-mono font-semibold"
            style={{
              fontVariantNumeric: 'tabular-nums',
              color: isOnBreak ? '#4B8FCC' : undefined,
              transition: 'color 0.2s ease',
            }}
          >
            {formatTime(timerSeconds)}
          </p>

          <div className="flex flex-col gap-2 items-end">
            {displayState === 'clocked-out' && (
              <Button onClick={startTracking} disabled={isLoading} size="sm">
                {isLoading ? 'Starting...' : 'Clock In'}
              </Button>
            )}

            {displayState === 'working' && (
              <>
                <Button onClick={stopTracking} disabled={isLoading} variant="destructive" size="sm">
                  {isLoading ? 'Stopping...' : 'Clock Out'}
                </Button>
                <Button onClick={startBreak} disabled={isLoading} variant="outline" size="sm">
                  <Coffee style={{ width: '0.75rem', height: '0.75rem', flexShrink: 0 }} />
                  {isLoading ? 'Starting...' : 'Break'}
                </Button>
              </>
            )}

            {displayState === 'on-break' && (
              <Button onClick={endBreak} disabled={isLoading} variant="outline" size="sm">
                {isLoading ? 'Ending...' : 'End Break'}
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function Home() {
  const { user } = useAuth();
  const { userData } = useUserData();
  const { notifications } = useNotifications();
  const firstName = user?.displayName?.split(' ')[0] || 'User';

  const now = Date.now();
  const announcements = notifications.filter(
    (n) => n.announcement === true && !n.dismissedByUser &&
      (!n.announcementExpiry || n.announcementExpiry.toMillis() > now),
  );

  // Get the first group from the user's groups array, or default to "General"
  const userGroup = userData?.groups?.[0] || "unassigned";
  const displayGroup = userGroup.charAt(0).toUpperCase() + userGroup.slice(1);

  const showTimeTracking = userData?.timeTracking === true;

  return (
    <AppLayout>
      <div className="max-w-5xl">
        <h1 className="text-2xl font-bold tracking-tight mb-2">
          Welcome, {firstName}
        </h1>

        <AnnouncementBanner announcements={announcements} />

        {/* Quick stats or widgets can go here */}
        <div className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-6 items-start">
          <Card style={{ background: '#171717', borderColor: 'transparent' }} className="py-0 gap-0">
            <CardContent className="p-6">
              <h3 className="text-sm font-medium uppercase tracking-wide mb-2 text-muted-foreground">Team</h3>
              <p className="text-2xl font-semibold">{displayGroup}</p>
            </CardContent>
          </Card>

          {showTimeTracking ? (
            <TimeTrackingWidget />
          ) : (
            <Card
              className="transition-colors py-0 gap-0"
              style={{ background: '#171717', borderColor: 'var(--border-subtle)' }}
              onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.15)')}
              onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--border-subtle)')}
            >
              <CardContent className="p-6">
                <h3 className="text-sm font-medium uppercase tracking-wide mb-2 text-muted-foreground">Active Projects</h3>
                <p className="text-2xl font-semibold">5</p>
              </CardContent>
            </Card>
          )}

          <ClockWidget />
        </div>
      </div>
    </AppLayout>
  );
}
