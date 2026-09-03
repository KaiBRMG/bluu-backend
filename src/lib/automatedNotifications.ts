import { notifications, telegramMessages, type NotificationContent } from '@/lib/notificationContent';

/**
 * Read-only catalogue of every notification the system sends **automatically**
 * (i.e. not an admin broadcast from /admin-portal/notifications).
 *
 * This file adds no copy of its own — RULE 1 of the notification system is that
 * titles/messages live only in `notificationContent.ts`. Each entry calls the
 * real factory with `{token}` placeholders where a runtime value is interpolated,
 * so the catalogue can never drift from what users actually receive.
 *
 * Purely for display. Adding an entry here does not send anything; sending is
 * always the API route named in `source`.
 *
 * ── Telegram ──────────────────────────────────────────────────────────────
 * `telegramEnabled` marks an entry that is also pushed to Telegram (in
 * addition to the in-app notification, for every recipient who has linked
 * their account) — see telegram.md and notifications.md#telegram-alerts.
 * Onboarding and OF Manager entries are deliberately left unset.
 *
 * ── Creators ──────────────────────────────────────────────────────────────
 * `AUTOMATED_CREATOR_NOTIFICATIONS` below is a second, separate catalogue for
 * creator-facing automated notifications. Creators have no in-app tray, so
 * Telegram is their only channel — these entries have no `NotificationContent`
 * (no `type`, no in-app `actionUrl`) and are rendered in their own section on
 * the Automated tab. This is a deliberate carve-out from the usual rule that
 * bot copy (`telegramMessages.*`) is never catalogued: that rule exists so a
 * bot message doesn't get confused with an in-app one on the same tab, and
 * these have no in-app counterpart to be confused with.
 */

/** Strips the Telegram HTML these creator messages use, for plain-text display. */
function stripTelegramFormatting(html: string): string {
  return html
    .replace(/<\/?b>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

export type AutomatedNotificationCategory =
  | 'Onboarding'
  | 'Custom Requests'
  | 'Leave'
  | 'Disputes'
  | 'Content Planning'
  | 'Model Submissions'
  | 'OF Manager';

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
  /** Also pushed to Telegram, for any recipient who has linked their account. */
  telegramEnabled?: boolean;
}

/** A creator-facing automated notification — Telegram only, no in-app tray. */
export interface AutomatedCreatorNotification {
  /** Factory name in `notificationContent.ts` (`telegramMessages.*`). */
  id: string;
  /** Short label for the event that fires it. */
  event: string;
  /** When it fires, in plain language. */
  trigger: string;
  /** Who receives it. Always a single creator for this catalogue. */
  recipients: string;
  /** Repo-relative path(s) of the handler(s) that send it. */
  sources: string[];
  /** Plain-text rendering of the real Telegram HTML, with `{token}` placeholders. */
  message: string;
}

export const AUTOMATED_NOTIFICATIONS: AutomatedNotification[] = [
  // ─── Onboarding ───────────────────────────────────────────────────────────
  {
    id: 'welcomeToTeam',
    category: 'Onboarding',
    event: 'First login',
    trigger:
      'A registered user signs in for the first time. Not sent when an admin registers them — that can be days before their start date.',
    recipients: 'The new user',
    sources: ['src/lib/services/userService.ts'],
    content: notifications.welcomeToTeam('{firstName}', '{groupName}'),
  },
  {
    id: 'adminNewUserAlert',
    category: 'Onboarding',
    event: 'First login without a group',
    trigger:
      'A user reaches their first login while still unassigned, i.e. registered without a group. Silent in the normal flow, where the group is set at registration.',
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
    telegramEnabled: true,
  },
  {
    id: 'crRejected',
    category: 'Custom Requests',
    event: 'CR rejected',
    trigger: 'An entry’s status changes to Rejected.',
    recipients: 'The CA who created the entry',
    sources: ['src/app/api/campaign-tracking/[id]/route.ts'],
    content: notifications.crRejected('{editorName}', '{CR}', '{stageName}'),
    telegramEnabled: true,
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
    telegramEnabled: true,
  },
  {
    id: 'crTransferred',
    category: 'Custom Requests',
    event: 'CR / campaign transferred',
    trigger:
      'A CA transfers their own entry to another user, making them responsible for the fan follow-up and remaining balance.',
    recipients: 'The user receiving the transfer',
    sources: ['src/app/api/campaign-tracking/[id]/transfer/route.ts'],
    content: notifications.crTransferred('{transferrerName}', '{stageName}', '{campaigns | custom-requests}'),
    telegramEnabled: true,
  },
  {
    id: 'crTransferredOnBehalf',
    category: 'Custom Requests',
    event: 'CR / campaign transferred by someone else',
    trigger:
      'A manager (or any user who does not own the entry) transfers it to another user — the copy names the previous owner instead of the transferrer.',
    recipients: 'The user receiving the transfer',
    sources: ['src/app/api/campaign-tracking/[id]/transfer/route.ts'],
    content: notifications.crTransferredOnBehalf('{previousOwnerName}', '{stageName}', '{campaigns | custom-requests}'),
    telegramEnabled: true,
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
    telegramEnabled: true,
  },
  {
    id: 'leaveDenied',
    category: 'Leave',
    event: 'Leave denied',
    trigger: 'An admin denies a pending leave request; the leave balance is refunded at the same time.',
    recipients: 'The user who requested the leave',
    sources: ['src/app/api/shifts/leave/[leaveId]/approve/route.ts'],
    content: notifications.leaveDenied('{paid | unpaid}', '{date}'),
    telegramEnabled: true,
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
    telegramEnabled: true,
  },
  {
    id: 'disputeCaApproved',
    category: 'Disputes',
    event: 'Dispute approved by CA',
    trigger: 'The assigned CA approves the dispute, passing it up to a team leader.',
    recipients: 'The user who submitted the dispute',
    sources: ['src/app/api/disputes/[disputeId]/ca-approval/route.ts'],
    content: notifications.disputeCaApproved('{assignedToName}'),
    telegramEnabled: true,
  },
  {
    id: 'disputeCaRejected',
    category: 'Disputes',
    event: 'Dispute rejected by CA',
    trigger: 'The assigned CA rejects the dispute. The REASON clause is omitted when no reason is given.',
    recipients: 'The user who submitted the dispute',
    sources: ['src/app/api/disputes/[disputeId]/ca-approval/route.ts'],
    content: notifications.disputeCaRejected('{assignedToName}', '{reason}'),
    telegramEnabled: true,
  },
  {
    id: 'disputeAdminApproved',
    category: 'Disputes',
    event: 'Dispute approved by admin',
    trigger: 'A team leader gives final approval on the dispute.',
    recipients: 'The user who submitted the dispute',
    sources: ['src/app/api/disputes/[disputeId]/admin-approval/route.ts'],
    content: notifications.disputeAdminApproved(),
    telegramEnabled: true,
  },
  {
    id: 'disputeAdminRejected',
    category: 'Disputes',
    event: 'Dispute rejected by admin',
    trigger: 'A team leader rejects the dispute. The REASON clause is omitted when no reason is given.',
    recipients: 'The user who submitted the dispute',
    sources: ['src/app/api/disputes/[disputeId]/admin-approval/route.ts'],
    content: notifications.disputeAdminRejected('{reason}'),
    telegramEnabled: true,
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
    telegramEnabled: true,
  },

  // ─── Model Submissions ────────────────────────────────────────────────────
  {
    id: 'modelSubmissionReceived',
    category: 'Model Submissions',
    event: 'Model application received',
    trigger:
      'An applicant submits the public /model-submissions form. This is the only unauthenticated write path in the project, so the notification is the first staff-visible signal.',
    recipients: 'Every user with permission for the Model Submissions page',
    sources: ['src/app/api/model-submissions/submit/route.ts'],
    content: notifications.modelSubmissionReceived('{applicantName}', '{city}, {country}'),
    telegramEnabled: true,
  },

  // ─── OF Manager ───────────────────────────────────────────────────────────
  // Both of these are operational diagnostics rather than workflow events, and
  // both are addressed to a single named maintainer rather than to a group —
  // see the note on OPS_ALERT_RECIPIENT_UID for why that is deliberate here and
  // not a violation of "never hardcode a uid". They are catalogued anyway: rule
  // 15 asks for a record of everything the system sends on its own, and an
  // admin looking at this tab should be able to see that these exist.
  {
    id: 'ofMediaCacheCritical',
    category: 'OF Manager',
    event: 'Media cache reached its size threshold',
    trigger:
      'The daily Vercel Cron reading of the onlyfans-media/ Cloud Storage prefix finds it at or above 50 GB. Sent once ever — the condition persists until someone sets a lifecycle rule, so repeating it would add nothing.',
    recipients: 'One named maintainer (OPS_ALERT_RECIPIENT_UID)',
    sources: [
      'src/app/api/cron/onlyfans-media-usage/route.ts',
      'src/lib/services/onlyfansMediaUsage.ts',
    ],
    content: notifications.ofMediaCacheCritical('{size}', '{period}'),
  },
  {
    id: 'ofVideoSourceHostUnrecognised',
    category: 'OF Manager',
    event: 'Video renditions served from an unrecognised host',
    trigger:
      'Normalising a message page finds the provider serving its 240p/720p video renditions from a host CDN_URL_PATTERN rejects, so every video falls back to the billed-by-the-megabyte source file. Sent once ever, from `after()` on the message-history route.',
    recipients: 'One named maintainer (OPS_ALERT_RECIPIENT_UID)',
    sources: [
      'src/app/api/onlyfans/chats/[chatId]/messages/route.ts',
      'src/lib/services/onlyfansOpsAlerts.ts',
    ],
    content: notifications.ofVideoSourceHostUnrecognised('{host}'),
  },

  // NOTE — `notifications.releaseNote()` is deliberately NOT catalogued here,
  // and that is the one sanctioned exception to cross-cutting rule 15. This tab
  // is a record of what the system sends *on an ongoing basis*, so an admin can
  // see standing behaviour; a release note is once-off and self-disarming
  // (`APP_UPDATE.releaseNote` returns to null after the release), so listing it
  // would describe the system as permanently sending something it sends once.
  // Do not "fix" this by adding an entry.
];

export const AUTOMATED_NOTIFICATION_CATEGORIES: AutomatedNotificationCategory[] = [
  'Onboarding',
  'Custom Requests',
  'Leave',
  'Disputes',
  'Content Planning',
  'Model Submissions',
  'OF Manager',
];

// ─── Creators (Telegram only — see the header note) ────────────────────────
export const AUTOMATED_CREATOR_NOTIFICATIONS: AutomatedCreatorNotification[] = [
  {
    id: 'creatorNewCustomRequest',
    event: 'Custom request approved',
    trigger: 'A Custom Request entry moves from Awaiting Approval to In Progress (an OFAM approval).',
    recipients: 'The creator',
    sources: ['src/app/api/campaign-tracking/[id]/route.ts'],
    message: stripTelegramFormatting(telegramMessages.creatorNewCustomRequest('{fan}', '{Total Amount}')),
  },
  {
    id: 'creatorNewItemRequest',
    event: 'Item request approved',
    trigger: 'An Item Request entry moves from Awaiting Approval to In Progress (an OFAM approval).',
    recipients: 'The creator',
    sources: ['src/app/api/campaign-tracking/[id]/route.ts'],
    message: stripTelegramFormatting(telegramMessages.creatorNewItemRequest('{fan}', '{Total Amount}')),
  },
  {
    id: 'creatorNewScheduledCall',
    event: 'Call scheduled',
    trigger: 'A Call entry moves from Awaiting Approval to In Progress (an OFAM approval).',
    recipients: 'The creator',
    sources: ['src/app/api/campaign-tracking/[id]/route.ts'],
    message: stripTelegramFormatting(
      telegramMessages.creatorNewScheduledCall('{Call Type}', '{fan}', '{date}', '{Total Amount}'),
    ),
  },
  {
    id: 'creatorNewContentRequest',
    event: 'Content request created',
    trigger: 'An account manager creates a new content-planning brief for the creator.',
    recipients: 'The creator',
    sources: ['src/app/api/content-planning/route.ts'],
    message: stripTelegramFormatting(telegramMessages.creatorNewContentRequest()),
  },
];
