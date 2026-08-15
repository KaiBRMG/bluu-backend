'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Bell, Trash2, CheckCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useNotifications } from '@/hooks/useNotifications';
import { useAuth } from '@/components/AuthProvider';
import { NotificationDocument, NotificationType } from '@/types/firestore';
import type { Timestamp } from '@/types/firestore';
import { notificationTypeDot } from '@/lib/notificationTypeBadge';
import { HoverCard, HoverCardTrigger, HoverCardContent } from '@/components/ui/hover-card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

// ─── Helpers ────────────────────────────────────────────────────────

/** The unread badge. Status-red from the semantic palette (DESIGN.md §2) with
 *  near-black ink — the same "dark ink on a light accent" move the creator
 *  portal's ACCENT_BTN makes, and for the same reason: white on #f87171 reads
 *  2.6:1 and fails outright, while #0A0A0A on it reads 7.2:1. Red rather than
 *  the strictly-semantic "pending" orange because a count badge is platform
 *  chrome first — every OS trains this exact shape to mean red. */
const BADGE_FILL = '#f87171';
const BADGE_INK = '#0A0A0A';

/** `now` is threaded in rather than read from `Date.now()` so the whole open
 *  tray re-stamps off one clock tick — no two rows can disagree about how long
 *  ago "5m" was. */
function relativeTime(ts: Timestamp | undefined, now: number): string {
  if (!ts) return '';
  const diffMin = Math.floor((now - ts.toMillis()) / 60_000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getDate() === b.getDate() &&
    a.getMonth() === b.getMonth() &&
    a.getFullYear() === b.getFullYear();
}

function isToday(ts: Timestamp | undefined): boolean {
  return ts ? isSameDay(ts.toDate(), new Date()) : false;
}

function isYesterday(ts: Timestamp | undefined): boolean {
  if (!ts) return false;
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  return isSameDay(ts.toDate(), yesterday);
}

interface GroupedNotifications {
  today: NotificationDocument[];
  yesterday: NotificationDocument[];
  earlier: NotificationDocument[];
}

function groupNotifications(notifications: NotificationDocument[]): GroupedNotifications {
  const groups: GroupedNotifications = { today: [], yesterday: [], earlier: [] };
  for (const n of notifications) {
    if (isToday(n.createdAt))           groups.today.push(n);
    else if (isYesterday(n.createdAt))  groups.yesterday.push(n);
    else                                groups.earlier.push(n);
  }
  return groups;
}

// ─── Sub-components ─────────────────────────────────────────────────

/** Sticky so the day you are reading is always named, however far you scroll
 *  inside the 480px panel. */
function SectionLabel({ label }: { label: string }) {
  return (
    <div
      className="sticky top-0 z-10 px-4 py-1.5 text-xs font-medium"
      style={{
        color: 'var(--foreground-secondary)',
        background: 'var(--sidebar-background)',
        borderBottom: '1px solid var(--border-subtle)',
      }}
    >
      {label}
    </div>
  );
}

/**
 * One mark carries two facts. The dot's hue is the notification's type; its
 * state is whether you have read it — filled with a soft ring while unread,
 * dimmed in place once read. That is what makes "Mark all read" feel like
 * something happened: every ring in the list fades out together, in place,
 * over 200ms. Nothing moves, nothing is invented — the list simply goes quiet.
 */
function TypeMark({ type, unread }: { type: NotificationType; unread: boolean }) {
  const hue = notificationTypeDot(type);
  return (
    <span
      aria-hidden
      className="mt-[0.3rem] size-2 shrink-0 rounded-full transition-[background-color,box-shadow,opacity] duration-200"
      style={{
        background: hue,
        opacity: unread ? 1 : 0.3,
        boxShadow: unread ? `0 0 0 3px ${hue}26` : `0 0 0 0 ${hue}00`,
      }}
    />
  );
}

function NotificationRow({
  notification,
  now,
  onMarkRead,
}: {
  notification: NotificationDocument;
  now: number;
  onMarkRead: (id: string, actionUrl?: string | null) => void;
}) {
  const isUnread = !notification.read;

  return (
    <button
      type="button"
      onClick={() => onMarkRead(notification.id, notification.actionUrl)}
      className={cn(
        'group relative flex w-full gap-2.5 border-b border-border-subtle px-4 py-3 text-left',
        'transition-colors hover:bg-hover-bg active:bg-active-bg',
        'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-zinc-500',
        // Unread rests one overlay step below hover (0.025 vs 0.055) — it used
        // to rest *at* the hover value, so pointing at an unread row did
        // nothing and every read row looked unread under the cursor.
        isUnread ? 'bg-white/[0.025]' : 'bg-transparent',
      )}
    >
      <TypeMark type={notification.type} unread={isUnread} />

      <span className="min-w-0 flex-1">
        <span className="flex items-start justify-between gap-2">
          <span
            className="text-sm leading-snug"
            style={{ fontWeight: isUnread ? 600 : 400, color: 'var(--foreground)' }}
          >
            {notification.title}
            {isUnread && <span className="sr-only"> (unread)</span>}
          </span>
          <span
            className="shrink-0 text-[11px] tabular-nums"
            style={{ color: 'var(--foreground-secondary)' }}
          >
            {relativeTime(notification.createdAt, now)}
          </span>
        </span>

        <HoverCard openDelay={300}>
          <HoverCardTrigger asChild>
            <span
              className="mt-0.5 line-clamp-2 block text-xs"
              style={{ color: 'var(--foreground-secondary)' }}
            >
              {notification.message}
            </span>
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
            {notification.message}
          </HoverCardContent>
        </HoverCard>
      </span>
    </button>
  );
}

/** Shaped to the row it replaces, so the panel does not resize when the
 *  stream lands. Previously this state rendered the empty copy — the tray
 *  claimed you were caught up before it had finished asking. */
function LoadingRows() {
  return (
    <div aria-hidden>
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex gap-2.5 border-b border-border-subtle px-4 py-3">
          <Skeleton className="mt-[0.3rem] size-2 shrink-0 rounded-full" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3.5 w-2/5" />
            <Skeleton className="h-3 w-4/5" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** House empty state: quiet lines, no illustration (DESIGN.md §5). The second
 *  line names what actually lands here, which is the only orienting thing to
 *  say to someone who has never seen this panel hold anything. */
function EmptyState() {
  return (
    <div className="px-6 py-14 text-center">
      <p className="text-sm" style={{ color: 'var(--foreground)' }}>
        Nothing outstanding.
      </p>
      <p className="mt-1 text-xs" style={{ color: 'var(--foreground-secondary)' }}>
        Shift, request and approval activity lands here.
      </p>
    </div>
  );
}

// ─── Main Tray Component ─────────────────────────────────────────────

export default function NotificationTray() {
  const { notifications, unreadCount, loading } = useNotifications();
  const { user } = useAuth();
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [isMarkingAll, setIsMarkingAll] = useState(false);
  const [isDismissing, setIsDismissing] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [strikeKey, setStrikeKey] = useState(0);
  const trayRef = useRef<HTMLDivElement>(null);
  const bellRef = useRef<HTMLButtonElement>(null);

  // The bell rings for arrivals only. `settled` swallows the provider's first
  // delivery — on a cold start the stream goes 0 → n, and swinging the bell at
  // someone who just opened the app is noise, not news.
  const prevUnreadRef = useRef(unreadCount);
  const settledRef = useRef(false);
  useEffect(() => {
    if (loading) return;
    if (!settledRef.current) {
      settledRef.current = true;
      prevUnreadRef.current = unreadCount;
      return;
    }
    if (unreadCount > prevUnreadRef.current) setStrikeKey((k) => k + 1);
    prevUnreadRef.current = unreadCount;
  }, [loading, unreadCount]);

  // Keep the stamps honest while the panel is open. A tray left open on a
  // second monitor used to freeze at "5m ago" for the rest of the shift.
  useEffect(() => {
    if (!isOpen) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, [isOpen]);

  // Click-outside and Escape, with focus handed back to the bell.
  useEffect(() => {
    if (!isOpen) return;
    function handleClickOutside(event: MouseEvent) {
      if (trayRef.current && !trayRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsOpen(false);
        bellRef.current?.focus();
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  async function getIdToken(): Promise<string | null> {
    if (!user) return null;
    return user.getIdToken();
  }

  async function handleMarkRead(notificationId: string, actionUrl?: string | null) {
    try {
      const idToken = await getIdToken();
      if (!idToken) throw new Error('Not signed in');
      const res = await fetch('/api/notifications/mark-read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ notificationId }),
      });
      if (!res.ok) throw new Error(`Request failed: ${res.status}`);
    } catch (err) {
      console.error('[NotificationTray] mark-read error:', err);
      // No success toast: the dot dimming in place is the confirmation, and
      // this fires on every row click (DESIGN.md §5, the high-frequency
      // exception). Failures still speak.
      toast.error("Couldn't mark that as read.");
    }

    if (actionUrl) {
      if (actionUrl.startsWith('http://') || actionUrl.startsWith('https://')) {
        window.open(actionUrl, '_blank', 'noopener,noreferrer');
      } else {
        router.push(actionUrl);
      }
      setIsOpen(false);
    }
  }

  async function handleMarkAllRead() {
    if (isMarkingAll || unreadCount === 0) return;
    const count = unreadCount;
    setIsMarkingAll(true);
    try {
      const idToken = await getIdToken();
      if (!idToken) throw new Error('Not signed in');
      const res = await fetch('/api/notifications/mark-read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ all: true }),
      });
      if (!res.ok) throw new Error(`Request failed: ${res.status}`);
      toast.success(count === 1 ? 'Marked 1 notification as read.' : `Marked ${count} notifications as read.`);
    } catch (err) {
      console.error('[NotificationTray] mark-all-read error:', err);
      toast.error("Couldn't mark everything as read.");
    } finally {
      setIsMarkingAll(false);
    }
  }

  async function handleDismissRead() {
    if (isDismissing) return;
    const count = notifications.filter((n) => n.read && !n.announcement).length;
    setIsDismissing(true);
    try {
      const idToken = await getIdToken();
      if (!idToken) throw new Error('Not signed in');
      const res = await fetch('/api/notifications/dismiss', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error(`Request failed: ${res.status}`);
      toast.success(count === 1 ? 'Cleared 1 read notification.' : `Cleared ${count} read notifications.`);
    } catch (err) {
      console.error('[NotificationTray] dismiss error:', err);
      toast.error("Couldn't clear those notifications.");
    } finally {
      setIsDismissing(false);
    }
  }

  const grouped = useMemo(() => groupNotifications(notifications), [notifications]);
  const hasReadNotifications = notifications.some((n) => n.read && !n.announcement);

  const sections: Array<[string, NotificationDocument[]]> = [
    ['Today', grouped.today],
    ['Yesterday', grouped.yesterday],
    ['Earlier', grouped.earlier],
  ];

  return (
    <div className="relative" ref={trayRef}>
      {/* Bell */}
      <button
        ref={bellRef}
        type="button"
        className="relative rounded-lg bg-transparent p-2 transition-colors hover:bg-hover-bg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-500"
        onClick={() => setIsOpen((v) => !v)}
        aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
      >
        {/* Keyed so each arrival restarts the swing rather than being swallowed
            by an animation already in flight. */}
        <span key={strikeKey} className={cn('block', strikeKey > 0 && 'notification-bell-strike')}>
          <Bell className="size-5" style={{ opacity: 'var(--icon-inactive)' }} />
        </span>
        {unreadCount > 0 && (
          <span
            key={`badge-${strikeKey}`}
            className="notification-badge-in absolute top-0.5 right-0.5 flex h-[1.1rem] min-w-[1.1rem] items-center justify-center rounded-full px-0.5 text-[10px] leading-none font-bold tabular-nums"
            style={{ background: BADGE_FILL, color: BADGE_INK }}
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Panel */}
      {isOpen && (
        <div
          role="dialog"
          aria-label="Notifications"
          className="notification-tray-in absolute right-0 mt-2 flex w-96 max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl z-[var(--z-overlay)]"
          style={{
            background: 'var(--sidebar-background)',
            border: '1px solid var(--border-subtle)',
            maxHeight: '480px',
          }}
        >
          {/* Header */}
          <div
            className="flex shrink-0 items-center justify-between px-4 py-3"
            style={{ borderBottom: '1px solid var(--border-subtle)' }}
          >
            <span className="text-sm font-semibold" style={{ color: 'var(--foreground)' }}>
              Notifications
            </span>
            <div className="flex items-center gap-1">
              {unreadCount > 0 && (
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={handleMarkAllRead}
                  disabled={isMarkingAll}
                  className="text-foreground-secondary hover:bg-hover-bg hover:text-foreground"
                >
                  <CheckCheck aria-hidden />
                  Mark all read
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={handleDismissRead}
                disabled={isDismissing || !hasReadNotifications}
                aria-label="Clear read notifications"
                title="Clear read notifications"
                className="text-foreground-secondary hover:bg-hover-bg hover:text-[#f87171]"
              >
                <Trash2 aria-hidden />
              </Button>
            </div>
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <LoadingRows />
            ) : notifications.length === 0 ? (
              <EmptyState />
            ) : (
              sections.map(([label, items]) =>
                items.length === 0 ? null : (
                  <div key={label}>
                    <SectionLabel label={label} />
                    {items.map((n) => (
                      <NotificationRow
                        key={n.id}
                        notification={n}
                        now={now}
                        onMarkRead={handleMarkRead}
                      />
                    ))}
                  </div>
                ),
              )
            )}
          </div>
        </div>
      )}
    </div>
  );
}
