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
