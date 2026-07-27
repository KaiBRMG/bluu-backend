import { notifications, type NotificationContent } from '@/lib/notificationContent';

/**
 * Read-only catalogue of every notification the system sends **automatically**
 * (i.e. not an admin broadcast from /admin/notifications).
 *
 * This file adds no copy of its own — RULE 1 of the notification system is that
 * titles/messages live only in `notificationContent.ts`. Each entry calls the
 * real factory with `{token}` placeholders where a runtime value is interpolated,
 * so the catalogue can never drift from what users actually receive.
 *
 * Purely for display. Adding an entry here does not send anything; sending is
 * always the API route named in `source`.
 */

export type AutomatedNotificationCategory =
  | 'Onboarding'
  | 'Custom Requests'
  | 'Leave'
  | 'Disputes'
  | 'Content Planning';

export interface AutomatedNotification {
  /** Factory name in `notificationContent.ts` — stable id for React keys. */
  id: string;
  category: AutomatedNotificationCategory;
  /** Short label for the event that fires it. */
  event: string;
  /** When it fires, in plain language. */
  trigger: string;
  /** Who receives it. */
  recipients: string;
  /** Repo-relative path(s) of the handler(s) that send it. */
  sources: string[];
  /** Real content, with `{token}` placeholders for interpolated values. */
  content: NotificationContent;
}

export const AUTOMATED_NOTIFICATIONS: AutomatedNotification[] = [
  // ─── Onboarding ───────────────────────────────────────────────────────────
  {
    id: 'welcomeToTeam',
    category: 'Onboarding',
    event: 'New user created',
    trigger: 'A user signs in for the first time and their user document is created.',
    recipients: 'The new user',
    sources: ['src/lib/services/userService.ts'],
    content: notifications.welcomeToTeam('{firstName}'),
  },
  {
    id: 'adminNewUserAlert',
    category: 'Onboarding',
    event: 'New user created',
    trigger:
      'Sent alongside the welcome message, so an admin assigns the new user to a group and unblocks their onboarding.',
    recipients: 'Every member of the admin group',
    sources: ['src/lib/services/userService.ts'],
    content: notifications.adminNewUserAlert(),
  },

  // ─── Custom Requests ──────────────────────────────────────────────────────
  {
    id: 'crCreated',
    category: 'Custom Requests',
    event: 'CR submitted',
    trigger: 'A CA creates a new campaign-tracking entry (CR, call or item).',
    recipients: 'Every member of the OFAM group',
    sources: ['src/app/api/campaign-tracking/create/route.ts'],
    content: notifications.crCreated('{creatorName}', '{stageName}'),
  },
  {
    id: 'crRejected',
    category: 'Custom Requests',
    event: 'CR rejected',
    trigger: 'An entry’s status changes to Rejected.',
    recipients: 'The CA who created the entry',
    sources: ['src/app/api/campaign-tracking/[id]/route.ts'],
    content: notifications.crRejected('{editorName}', '{CR}', '{stageName}'),
  },
  {
    id: 'crCompleted',
    category: 'Custom Requests',
    event: 'CR completed',
    trigger:
      'An entry’s status changes to Completed — either by a staff edit, or by the creator marking it done in the creator portal.',
    recipients: 'Every member of the OFAM group',
    sources: [
      'src/app/api/campaign-tracking/[id]/route.ts',
      'src/app/api/campaign-tracking/[id]/creator-complete/route.ts',
    ],
    content: notifications.crCompleted('{CR}', '{stageName}'),
  },
  {
    id: 'crTransferred',
    category: 'Custom Requests',
    event: 'CR / campaign transferred',
    trigger:
      'A CA transfers an entry to another user, making them responsible for the fan follow-up and remaining balance.',
    recipients: 'The user receiving the transfer',
    sources: ['src/app/api/campaign-tracking/[id]/transfer/route.ts'],
    content: notifications.crTransferred('{transferrerName}', '{stageName}', '{campaigns | custom-requests}'),
  },

  // ─── Leave ────────────────────────────────────────────────────────────────
  {
    id: 'leaveApproved',
    category: 'Leave',
    event: 'Leave approved',
    trigger: 'An admin approves a pending leave request.',
    recipients: 'The user who requested the leave',
    sources: ['src/app/api/shifts/leave/[leaveId]/approve/route.ts'],
    content: notifications.leaveApproved('{paid | unpaid}', '{date}'),
  },
  {
    id: 'leaveDenied',
    category: 'Leave',
    event: 'Leave denied',
    trigger: 'An admin denies a pending leave request; the leave balance is refunded at the same time.',
    recipients: 'The user who requested the leave',
    sources: ['src/app/api/shifts/leave/[leaveId]/approve/route.ts'],
    content: notifications.leaveDenied('{paid | unpaid}', '{date}'),
  },

  // ─── Disputes ─────────────────────────────────────────────────────────────
  {
    id: 'disputeAssigned',
    category: 'Disputes',
    event: 'Dispute submitted',
    trigger: 'A dispute is created against a sale and assigned to someone (skipped when assignee is "No One").',
    recipients: 'The CA the dispute is assigned to',
    sources: ['src/app/api/disputes/route.ts'],
    content: notifications.disputeAssigned('{createdByName}'),
  },
  {
    id: 'disputeCaApproved',
    category: 'Disputes',
    event: 'Dispute approved by CA',
    trigger: 'The assigned CA approves the dispute, passing it up to a team leader.',
    recipients: 'The user who submitted the dispute',
    sources: ['src/app/api/disputes/[disputeId]/ca-approval/route.ts'],
    content: notifications.disputeCaApproved('{assignedToName}'),
  },
  {
    id: 'disputeCaRejected',
    category: 'Disputes',
    event: 'Dispute rejected by CA',
    trigger: 'The assigned CA rejects the dispute. The REASON clause is omitted when no reason is given.',
    recipients: 'The user who submitted the dispute',
    sources: ['src/app/api/disputes/[disputeId]/ca-approval/route.ts'],
    content: notifications.disputeCaRejected('{assignedToName}', '{reason}'),
  },
  {
    id: 'disputeAdminApproved',
    category: 'Disputes',
    event: 'Dispute approved by admin',
    trigger: 'A team leader gives final approval on the dispute.',
    recipients: 'The user who submitted the dispute',
    sources: ['src/app/api/disputes/[disputeId]/admin-approval/route.ts'],
    content: notifications.disputeAdminApproved(),
  },
  {
    id: 'disputeAdminRejected',
    category: 'Disputes',
    event: 'Dispute rejected by admin',
    trigger: 'A team leader rejects the dispute. The REASON clause is omitted when no reason is given.',
    recipients: 'The user who submitted the dispute',
    sources: ['src/app/api/disputes/[disputeId]/admin-approval/route.ts'],
    content: notifications.disputeAdminRejected('{reason}'),
  },

  // ─── Content Planning ─────────────────────────────────────────────────────
  {
    id: 'contentPlanCompleted',
    category: 'Content Planning',
    event: 'Content request completed',
    trigger: 'A creator marks a content-planning request as completed in the creator portal.',
    recipients: 'Every member of the OFAM group',
    sources: ['src/app/api/content-planning/[id]/creator-complete/route.ts'],
    content: notifications.contentPlanCompleted('{stageName}', '{contentSummary}'),
  },
];

export const AUTOMATED_NOTIFICATION_CATEGORIES: AutomatedNotificationCategory[] = [
  'Onboarding',
  'Custom Requests',
  'Leave',
  'Disputes',
  'Content Planning',
];
