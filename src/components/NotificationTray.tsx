'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Bell, Trash2, CheckCheck } from 'lucide-react';
import { useNotifications } from '@/hooks/useNotifications';
import { useAuth } from '@/components/AuthProvider';
import { NotificationDocument, NotificationType } from '@/types/firestore';
import { Timestamp } from 'firebase/firestore';

// ─── Helpers ────────────────────────────────────────────────────────

function getTypeStripe(type: NotificationType): string {
  switch (type) {
    case 'shift':   return '#3b82f6'; // blue
    case 'alert':   return '#ef4444'; // red
    case 'success': return '#22c55e'; // green
    case 'action':  return '#eab308'; // yellow
    default:        return 'var(--border-subtle)'; 
  }
}

function relativeTime(ts: Timestamp | undefined): string {
  if (!ts) return '';
  const diffMs = Date.now() - ts.toMillis();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1)  return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24)  return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}

function isToday(ts: Timestamp | undefined): boolean {
  if (!ts) return false;
  const d = ts.toDate();
  const now = new Date();
  return d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear();
}

function isYesterday(ts: Timestamp | undefined): boolean {
  if (!ts) return false;
  const d = ts.toDate();
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  return d.getDate() === yesterday.getDate() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getFullYear() === yesterday.getFullYear();
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

function SectionLabel({ label }: { label: string }) {
  return (
    <div
      className="px-4 py-1.5 text-xs font-semibold uppercase tracking-wide"
      style={{ color: 'var(--foreground-muted)' }}
    >
      {label}
    </div>
  );
}

function NotificationRow({
  notification,
  onMarkRead,
}: {
  notification: NotificationDocument;
  onMarkRead: (id: string, actionUrl?: string | null) => void;
}) {
  const stripe = getTypeStripe(notification.type);
  const isUnread = !notification.read;

  return (
    <button
      type="button"
      onClick={() => onMarkRead(notification.id, notification.actionUrl)}
      className="w-full text-left flex items-stretch transition-colors relative overflow-hidden"
      style={{
        background: isUnread ? 'var(--hover-background)' : 'transparent',
        borderBottom: '1px solid var(--border-subtle)',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--hover-background)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = isUnread ? 'var(--hover-background)' : 'transparent'; }}
    >
      {/* Type stripe */}
      <div className="flex-shrink-0 w-1 self-stretch" style={{ background: stripe }} />

      {/* Content */}
      <div className="flex-1 px-3 py-3 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <span
            className="text-sm leading-snug"
            style={{
              fontWeight: isUnread ? 600 : 400,
              color: 'var(--foreground)',
            }}
          >
            {notification.title}
          </span>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <span className="text-xs" style={{ color: 'var(--foreground-muted)' }}>
              {relativeTime(notification.createdAt)}
            </span>
            {isUnread && (
              <span
                className="w-2 h-2 rounded-full flex-shrink-0"
                style={{ background: '#ef4444' }}
              />
            )}
          </div>
        </div>
        <p
          className="text-xs mt-0.5 line-clamp-2"
          style={{ color: 'var(--foreground-secondary)' }}
        >
          {notification.message}
        </p>
      </div>
    </button>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
      <div
        className="w-12 h-12 rounded-full flex items-center justify-center mb-3"
        style={{ background: 'var(--hover-background)' }}
      >
        <Bell className="w-5 h-5" style={{ color: 'var(--foreground-muted)' }} />
      </div>
      <p className="text-sm font-medium" style={{ color: 'var(--foreground)' }}>
        You&apos;re all caught up!
      </p>
      <p className="text-xs mt-1" style={{ color: 'var(--foreground-muted)' }}>
        No new notifications right now.
      </p>
    </div>
  );
}

// ─── Main Tray Component ─────────────────────────────────────────────

export default function NotificationTray() {
  const { notifications, unreadCount } = useNotifications();
  const { user } = useAuth();
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [isMarkingAll, setIsMarkingAll] = useState(false);
  const [isDismissing, setIsDismissing] = useState(false);
  const trayRef = useRef<HTMLDivElement>(null);

  // Click-outside handler
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (trayRef.current && !trayRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  async function getIdToken(): Promise<string | null> {
    if (!user) return null;
    return user.getIdToken();
  }

  async function handleMarkRead(notificationId: string, actionUrl?: string | null) {
    try {
      const idToken = await getIdToken();
      if (!idToken) return;
      await fetch('/api/notifications/mark-read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ notificationId }),
      });
    } catch (err) {
      console.error('[NotificationTray] mark-read error:', err);
    }

    if (actionUrl) {
      router.push(actionUrl);
      setIsOpen(false);
    }
  }

  async function handleMarkAllRead() {
    if (isMarkingAll || unreadCount === 0) return;
    setIsMarkingAll(true);
    try {
      const idToken = await getIdToken();
      if (!idToken) return;
      await fetch('/api/notifications/mark-read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ all: true }),
      });
    } catch (err) {
      console.error('[NotificationTray] mark-all-read error:', err);
    } finally {
      setIsMarkingAll(false);
    }
  }

  async function handleDismissRead() {
    if (isDismissing) return;
    setIsDismissing(true);
    try {
      const idToken = await getIdToken();
      if (!idToken) return;
      await fetch('/api/notifications/dismiss', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({}),
      });
    } catch (err) {
      console.error('[NotificationTray] dismiss error:', err);
    } finally {
      setIsDismissing(false);
    }
  }

  const grouped = groupNotifications(notifications);
  const hasReadNotifications = notifications.some((n) => n.read && !n.announcement);

  return (
    <div className="relative" ref={trayRef}>
      {/* Bell button */}
      <button
        type="button"
        className="relative p-2 rounded-lg transition-colors"
        style={{ background: 'transparent' }}
        onClick={() => setIsOpen((v) => !v)}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--hover-background)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
        aria-label="Notifications"
      >
        <Bell className="w-5 h-5" style={{ opacity: 'var(--icon-inactive)' }} />
        {unreadCount > 0 && (
          <span
            className="absolute top-0.5 right-0.5 min-w-[1.1rem] h-[1.1rem] flex items-center justify-center rounded-full text-white text-[10px] font-bold leading-none px-0.5"
            style={{ background: '#ef4444' }}
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Tray popover */}
      {isOpen && (
        <div
          className="absolute right-0 mt-2 w-96 rounded-xl shadow-2xl z-50 overflow-hidden flex flex-col"
          style={{
            background: 'var(--sidebar-background)',
            border: '1px solid var(--border-subtle)',
            maxHeight: '480px',
          }}
        >
          {/* Header */}
          <div
            className="flex items-center justify-between px-4 py-3 flex-shrink-0"
            style={{ borderBottom: '1px solid var(--border-subtle)' }}
          >
            <span className="font-semibold text-sm" style={{ color: 'var(--foreground)' }}>
              Notifications
            </span>
            <div className="flex items-center gap-2">
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={handleMarkAllRead}
                  disabled={isMarkingAll}
                  className="flex items-center gap-1 text-xs px-2 py-1 rounded transition-colors"
                  style={{ color: 'var(--foreground-secondary)' }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--hover-background)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                  title="Mark all as read"
                >
                  <CheckCheck className="w-3.5 h-3.5" />
                  <span>Mark all read</span>
                </button>
              )}
              <button
                type="button"
                onClick={handleDismissRead}
                disabled={isDismissing || !hasReadNotifications}
                className="p-1.5 rounded transition-colors"
                style={{
                  color: hasReadNotifications ? 'var(--foreground-muted)' : 'var(--border-subtle)',
                  cursor: hasReadNotifications ? 'pointer' : 'default',
                }}
                onMouseEnter={(e) => {
                  if (hasReadNotifications) e.currentTarget.style.color = '#ef4444';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = hasReadNotifications ? 'var(--foreground-muted)' : 'var(--border-subtle)';
                }}
                title="Clear read notifications"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Notification list */}
          <div className="overflow-y-auto flex-1">
            {notifications.length === 0 ? (
              <EmptyState />
            ) : (
              <>
                {grouped.today.length > 0 && (
                  <>
                    <SectionLabel label="Today" />
                    {grouped.today.map((n) => (
                      <NotificationRow key={n.id} notification={n} onMarkRead={handleMarkRead} />
                    ))}
                  </>
                )}
                {grouped.yesterday.length > 0 && (
                  <>
                    <SectionLabel label="Yesterday" />
                    {grouped.yesterday.map((n) => (
                      <NotificationRow key={n.id} notification={n} onMarkRead={handleMarkRead} />
                    ))}
                  </>
                )}
                {grouped.earlier.length > 0 && (
                  <>
                    <SectionLabel label="Earlier" />
                    {grouped.earlier.map((n) => (
                      <NotificationRow key={n.id} notification={n} onMarkRead={handleMarkRead} />
                    ))}
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
