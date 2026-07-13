"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import AppLayout from "@/components/AppLayout";
import { useAuth } from "@/components/AuthProvider";
import { useUserData } from "@/hooks/useUserData";
import { useTimeTracking } from "@/hooks/useTimeTracking";
import { useNotifications } from "@/hooks/useNotifications";
import { useResources } from "@/hooks/useResources";
import { usePinnedResources } from "@/hooks/usePinnedResources";
import { useBootPhase } from "@/contexts/BootLoaderContext";
import type { NotificationDocument, NotificationType } from "@/types/firestore";
import type { ResourceDocument } from "@/types/resource";
import { Coffee, Info, Link as LinkIcon } from 'lucide-react';
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { STATE_CONFIG } from "@/lib/stateColors";
import { HoverCard, HoverCardTrigger, HoverCardContent } from "@/components/ui/hover-card";

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
  // Normalise "GMT+2" → "GMT+2", already correct.
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
  const additionalPool = storedAdditional !== undefined
    ? storedAdditional
    : DEFAULT_ADDITIONAL_TZS;
  const effectiveAdditional = additionalPool.filter(
    tz => tz && (primaryOffsetMin === null || tzOffsetMinutes(tz) !== primaryOffsetMin)
  );

  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 10_000);
    return () => clearInterval(id);
  }, []);

  return (
    <Card className="gap-3 py-4">
      <CardHeader className="px-4">
        <CardDescription>Local Time</CardDescription>
      </CardHeader>
      <CardContent className="px-4">
        <div className="flex flex-col gap-2">
          {/* Primary timezone — always shown; '--:--' if not yet set */}
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-mono font-semibold" style={{ fontVariantNumeric: 'tabular-nums' }}>
              {primaryTz ? formatClockTime(primaryTz) : '--:--'}
            </span>
            {primaryTz ? (
              <span className="text-sm text-muted-foreground">{shortTzLabel(primaryTz)}</span>
            ) : (
              <span className="text-xs" style={{ color: '#DF626E' }}>Time zone not configured</span>
            )}
          </div>

          {/* Additional clocks */}
          {effectiveAdditional.map((tz) => (
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
    isHydrating,
  } = useTimeTracking();

  useBootPhase('home-timetracking', isHydrating);

  const config = STATE_CONFIG[displayState];
  const isOnBreak = displayState === 'on-break';
  const timerSeconds = isOnBreak && breakRemainingSeconds !== null ? breakRemainingSeconds : elapsedSeconds;

  return (
    <Card className="gap-3 py-4 transition-colors" style={{ background: config.bgAlpha }}>
      <CardHeader className="px-4">
        <CardDescription className="flex items-center gap-2" style={{ color: config.color }}>
          <config.Icon style={{ width: '0.875rem', height: '0.875rem', flexShrink: 0 }} />
          <span className="text-xs font-medium uppercase tracking-wide">
            {config.label}
          </span>
        </CardDescription>
      </CardHeader>
      <CardContent className="px-4">
        {/* Timer + Actions */}
        <div className="flex items-center justify-between gap-4">
          <p
            className="text-2xl font-mono font-semibold"
            style={{
              fontVariantNumeric: 'tabular-nums',
              color: isOnBreak ? STATE_CONFIG['on-break'].color : undefined,
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

function getTypeStripe(type: NotificationType): string {
  switch (type) {
    case 'shift':   return '#3b82f6';
    case 'alert':   return '#ef4444';
    case 'success': return '#22c55e';
    case 'action':  return '#eab308';
    default:        return 'var(--border-subtle)';
  }
}

function NotificationsWidget() {
  const { notifications, loading } = useNotifications();
  const { user } = useAuth();
  const router = useRouter();
  useBootPhase('home-notifications', loading);
  const unread = notifications.filter((n) => !n.read && !n.announcement);

  async function handleClick(notificationId: string, actionUrl?: string | null) {
    try {
      const idToken = user ? await user.getIdToken() : null;
      if (idToken) {
        await fetch('/api/notifications/mark-read', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
          body: JSON.stringify({ notificationId }),
        });
      }
    } catch (err) {
      console.error('[NotificationsWidget] mark-read error:', err);
    }

    if (actionUrl) {
      if (actionUrl.startsWith('http://') || actionUrl.startsWith('https://')) {
        window.open(actionUrl, '_blank', 'noopener,noreferrer');
      } else {
        router.push(actionUrl);
      }
    }
  }

  return (
    <Card className="gap-3 py-4">
      <CardHeader className="px-4">
        <CardDescription>Notifications</CardDescription>
      </CardHeader>
      <CardContent className="px-4">
        {unread.length === 0 ? (
          <p className="text-sm text-muted-foreground">No unread notifications.</p>
        ) : (
          <div className="flex flex-col gap-0 overflow-y-auto" style={{ maxHeight: '240px' }}>
            {unread.map((n) => {
              const stripe = getTypeStripe(n.type);
              const hasAction = !!n.actionUrl;
              return (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => handleClick(n.id, n.actionUrl)}
                  disabled={!hasAction}
                  className="w-full text-left flex items-stretch border-b border-border-subtle last:border-b-0 transition-colors"
                  style={{ cursor: hasAction ? 'pointer' : 'default', background: 'transparent' }}
                >
                  <div className="flex-shrink-0 w-1 self-stretch rounded-full mr-3" style={{ background: stripe }} />
                  <div className="flex-1 py-2 min-w-0">
                    <span className="text-sm font-semibold leading-snug" style={{ color: 'var(--foreground)' }}>
                      {n.title}
                    </span>
                    <HoverCard openDelay={300}>
                      <HoverCardTrigger asChild>
                        <p
                          className="text-xs mt-0.5 line-clamp-2 cursor-default"
                          style={{ color: 'var(--foreground-secondary)' }}
                        >
                          {n.message}
                        </p>
                      </HoverCardTrigger>
                      <HoverCardContent
                        side="left"
                        align="start"
                        className="w-72 text-xs"
                        style={{
                          background: 'var(--sidebar-background)',
                          border: '1px solid var(--border-subtle)',
                          color: 'var(--foreground-secondary)',
                        }}
                      >
                        {n.message}
                      </HoverCardContent>
                    </HoverCard>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function PinnedDocIcon({ icon }: { icon: ResourceDocument['icon'] }) {
  if (!icon) {
    return (
      <span className="flex h-5 w-5 shrink-0 items-center justify-center text-xs text-muted-foreground">
        •
      </span>
    );
  }
  if (icon.type === 'emoji') {
    return (
      <span className="flex h-5 w-5 shrink-0 items-center justify-center text-sm leading-none">
        {icon.value}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={icon.value} alt="" className="h-5 w-5 shrink-0 rounded-sm object-cover" />
  );
}

function PinnedResourceCard({ doc }: { doc: ResourceDocument }) {
  const targetUrl = doc.url ?? doc.notionPageUrl;

  const openDoc = () => {
    if (!targetUrl) return;
    window.open(targetUrl, '_blank', 'noopener,noreferrer');
  };

  const copyLink = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!targetUrl) return;
    try {
      await navigator.clipboard.writeText(targetUrl);
      toast('Link Copied!');
    } catch {
      toast.error('Could not copy link');
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={openDoc}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openDoc();
        }
      }}
      className="group flex cursor-pointer items-center gap-2.5 rounded-md px-3 py-2 transition-colors hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      style={{ border: '1px solid var(--border-subtle)' }}
    >
      <PinnedDocIcon icon={doc.icon} />
      <span className="flex-1 truncate text-sm font-medium text-foreground">
        {doc.name || 'Untitled'}
      </span>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={copyLink}
            aria-label="Copy link"
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <LinkIcon className="h-3.5 w-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top">Copy Link</TooltipContent>
      </Tooltip>
    </div>
  );
}

function PinnedResourcesWidget() {
  const { documents, loading } = useResources();
  const { pinned } = usePinnedResources();
  useBootPhase('home-resources', loading);

  // Resolve pinned IDs to documents, preserving pin order and dropping any that
  // are no longer shared with the user (so a hidden/removed doc just disappears).
  const pinnedDocs = useMemo(() => {
    if (!documents) return [];
    const byId = new Map(documents.map((d) => [d.id, d]));
    return pinned
      .map((id) => byId.get(id))
      .filter((d): d is ResourceDocument => !!d)
      .slice(0, 10);
  }, [documents, pinned]);

  return (
    <Card className="gap-3 py-4">
      <CardHeader className="px-4">
        <CardDescription className="flex items-center gap-2">
          Pinned Resources
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label="About pinned resources"
                className="inline-flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground"
              >
                <Info className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-[16rem]">
              Pin your most used resources here. Add or remove resources by heading to the{' '}
              <Link
                href="/applications/apps-resources"
                className="font-medium underline underline-offset-2"
              >
                Resources page
              </Link>
              .
            </TooltipContent>
          </Tooltip>
        </CardDescription>
      </CardHeader>
      <CardContent className="px-4">
        {loading && pinnedDocs.length === 0 ? (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full rounded-md" />
            ))}
          </div>
        ) : pinnedDocs.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No pinned resources yet. Pin your most used resources from the{' '}
            <Link
              href="/applications/apps-resources"
              className="underline underline-offset-2"
              style={{ color: 'var(--foreground)' }}
            >
              Resources page
            </Link>
            .
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {pinnedDocs.map((doc) => (
              <PinnedResourceCard key={doc.id} doc={doc} />
            ))}
          </div>
        )}
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

  const showTimeTracking = userData?.permittedPageIds?.includes('time-tracking') ?? false;
  const showResources = userData?.permittedPageIds?.includes('apps-resources') ?? false;

  const groupCard = (
    <Card
      className="gap-3 py-4"
      style={userGroup === 'unassigned' ? {
        background: 'rgba(223,98,110,0.1)',
        borderColor: 'rgba(223,98,110,0.3)',
      } : undefined}
    >
      <CardHeader className="px-4">
        <CardDescription>Group</CardDescription>
        <CardTitle className="text-2xl font-semibold">{displayGroup}</CardTitle>
      </CardHeader>
      {userGroup === 'unassigned' && (
        <CardContent className="px-4">
          <p className="text-xs" style={{ color: '#DF626E' }}>
            User functionality limited: You are currently not assigned to any groups. Please wait until a system administrator assigns you.
          </p>
        </CardContent>
      )}
    </Card>
  );

  const welcomeCard = (
    <Card className="gap-3 py-4">
      <CardHeader className="px-4">
        <CardDescription>Welcome to Bluu Backend!</CardDescription>
      </CardHeader>
      <CardContent className="px-4">
        <p className="text-sm text-muted-foreground">
          {"We're still a work-in-progress. See a bug? Have a suggestion? "}
          <a
            href="https://t.me/KaiJN"
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
            style={{ color: 'var(--foreground)' }}
          >
            Reach out to Kai
          </a>
          {" to help us improve your experience."}
        </p>
      </CardContent>
    </Card>
  );

  return (
    <AppLayout>
      <div className="max-w-5xl">
        <h1 className="text-2xl font-bold tracking-tight mb-2">
          Welcome, {firstName}
        </h1>

        <AnnouncementBanner announcements={announcements} />

        {/* Quick stats or widgets can go here */}
        <div className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-6 items-start">
          {/* Left two columns: each is an independent vertical stack, so a
              widget growing/shrinking never leaves a gap in the other column. */}
          <div
            className={`flex flex-col sm:flex-row gap-6 items-start ${
              showResources ? 'md:col-span-2' : 'md:col-span-3'
            }`}
          >
            <div className="flex flex-col gap-6 w-full sm:flex-1 min-w-0">
              {groupCard}
              <NotificationsWidget />
              <ClockWidget />
            </div>
            <div className="flex flex-col gap-6 w-full sm:flex-1 min-w-0">
              {showTimeTracking && <TimeTrackingWidget />}
              {welcomeCard}
            </div>
          </div>

          {/* Right column: pinned resources, spanning all the way to the right */}
          {showResources && <PinnedResourcesWidget />}
        </div>
      </div>
    </AppLayout>
  );
}
