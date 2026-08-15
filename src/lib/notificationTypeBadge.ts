import type { NotificationType } from '@/types/firestore';

/**
 * Badge treatment per notification type — shared by every admin notification
 * surface (sent history, recipients dialog, automated catalogue) so a type
 * always reads the same colour.
 */
export const NOTIFICATION_TYPE_BADGE: Record<string, { label: string; className: string }> = {
  shift:      { label: 'Shift',      className: 'bg-blue-500/15 text-blue-600 border-blue-500/30' },
  alert:      { label: 'Alert',      className: 'bg-red-500/15 text-red-600 border-red-500/30' },
  success:    { label: 'Success',    className: 'bg-green-500/15 text-green-600 border-green-500/30' },
  action:     { label: 'Action',     className: 'bg-amber-500/15 text-amber-600 border-amber-500/30' },
  system:     { label: 'System',     className: 'bg-muted text-muted-foreground' },
  onboarding: { label: 'Onboarding', className: 'bg-muted text-muted-foreground' },
};

export function notificationTypeBadge(type: NotificationType | string) {
  return NOTIFICATION_TYPE_BADGE[type] ?? NOTIFICATION_TYPE_BADGE.system;
}

/**
 * Dark-surface mark colour per notification type — the `-400` step of the
 * semantic palette (DESIGN.md §2), for the leading status dot in the
 * notification tray. Separate from `NOTIFICATION_TYPE_BADGE` on purpose: that
 * map's `-600` inks are pitched at the admin surfaces' light chips and are far
 * too dark to read as a mark on the near-black tray.
 *
 * This is the single source for a notification's hue on a dark ground —
 * import it, never re-map a type to a hex inline.
 */
export const NOTIFICATION_TYPE_DOT: Record<string, string> = {
  shift:      '#60a5fa', // status-blue   — info / scheduled
  alert:      '#f87171', // status-red    — error / rejected
  success:    '#4ade80', // status-green  — complete / approved
  action:     '#facc15', // status-yellow — attention needed
  system:     '#a1a1aa', // status-zinc   — neutral
  onboarding: '#a1a1aa',
};

export function notificationTypeDot(type: NotificationType | string): string {
  return NOTIFICATION_TYPE_DOT[type] ?? NOTIFICATION_TYPE_DOT.system;
}
