import type { NotificationType } from '@/types/firestore';

export interface NotificationContent {
  title: string;
  message: string;
  type: NotificationType;
  actionUrl: string | null;
}

export const notifications = {
  // ─── User onboarding ──────────────────────────────────────────────────────────
  // Personal information is collected during the onboarding flow itself (the
  // `profile` step), so there is no post-login nudge to go fill in Settings.
  // Fires on the user's FIRST LOGIN, not when an admin registers them — someone
  // may be registered days before their start date, and a welcome sitting in an
  // account they cannot yet reach is not a welcome.
  //
  // Registration normally assigns a group up front, so the group name is the
  // usual case; the group-less variant covers a deliberate "decide later".
  welcomeToTeam: (firstName: string, groupName?: string): NotificationContent => ({
    title: 'Welcome to Bluu Rock!',
    message: groupName
      ? `Hi ${firstName}, welcome to the team! You've been added to ${groupName}.`
      : `Hi ${firstName}, welcome to the team! You will be assigned to a group soon.`,
    type: 'success',
    actionUrl: null,
  }),

  // Only fires when a user reaches their first login while still unassigned —
  // i.e. an admin registered them without picking a group. In the normal flow
  // the group is set at registration and there is nothing to action, so this
  // stays silent rather than pinging every admin about every new hire.
  adminNewUserAlert: (): NotificationContent => ({
    title: 'Action Required',
    message: 'A new user has logged in without a group. Assign them one to give them access.',
    type: 'action',
    actionUrl: '/admin-portal/user-management',
  }),

  // ─── Custom requests ──────────────────────────────────────────────────────────
  crCreated: (creatorName: string, stageName: string): NotificationContent => ({
    title: '📷 A New CR has been Created!',
    message: `${creatorName} has added a new CR for ${stageName}. Review the details and approve ASAP!`,
    type: 'action',
    actionUrl: '/creator-portal/custom-requests',
  }),

  crRejected: (editorName: string, cr: string, stageName: string): NotificationContent => ({
    title: '❗Custom Request Rejected',
    message: `${editorName} has rejected ${cr} on ${stageName}. Please review the details and resubmit ASAP!`,
    type: 'alert',
    actionUrl: '/ca-portal/custom-requests',
  }),

  crCompleted: (cr: string, stageName: string): NotificationContent => ({
    title: '✅ Custom Request Completed',
    message: `${cr} has been completed on ${stageName}. Please review and send to the fan ASAP!`,
    type: 'success',
    actionUrl: '/creator-portal/custom-requests',
  }),

  crTransferred: (transferrerName: string, creatorName: string, actionUrl: string): NotificationContent => ({
    title: '🔄 Custom Transferred to You',
    message: `❗${transferrerName} transferred a custom on ${creatorName} to you. You are now responsible for following up the fan, collecting the remaining balance, and completing the request.`,
    type: 'action',
    actionUrl,
  }),

  // Sent when the transfer was performed by someone who did not own the entry
  // (e.g. a manager reassigning a CA's custom) — the recipient needs to know
  // whose custom they are inheriting, not who moved it.
  crTransferredOnBehalf: (previousOwnerName: string, creatorName: string, actionUrl: string): NotificationContent => ({
    title: '🔄 Custom Transferred to You',
    message: `❗${previousOwnerName}'s custom on ${creatorName} has been transferred to you. You are now responsible for following up the fan, collecting the remaining balance, and completing the request.`,
    type: 'action',
    actionUrl,
  }),

  // ─── Leave requests ───────────────────────────────────────────────────────────
  leaveApproved: (leaveLabel: string, dateStr: string): NotificationContent => ({
    title: '✅ Leave Request Approved',
    message: `Your ${leaveLabel} leave request on ${dateStr} has been approved.`,
    type: 'success',
    actionUrl: '/applications/time-tracking',
  }),

  leaveDenied: (leaveLabel: string, dateStr: string): NotificationContent => ({
    title: '❗️Leave Request Denied',
    message: `Your ${leaveLabel} leave request on ${dateStr} has been denied.`,
    type: 'alert',
    actionUrl: '/applications/time-tracking',
  }),

  // ─── Disputes ─────────────────────────────────────────────────────────────────
  disputeAssigned: (createdByName: string): NotificationContent => ({
    title: 'New Dispute',
    message: `${createdByName} has submitted a dispute against a sale assigned to you. Click here to check it out ASAP!`,
    type: 'action',
    actionUrl: '/ca-portal/disputes',
  }),

  disputeAdminApproved: (): NotificationContent => ({
    title: 'Dispute Approved',
    message: 'Good news 🎉 your dispute has been approved! It will be added to your Earnings Report soon.',
    type: 'success',
    actionUrl: '/ca-portal/disputes',
  }),

  disputeAdminRejected: (reason?: string): NotificationContent => ({
    title: 'Dispute Rejected',
    message: reason
      ? `❗️Your dispute has been Rejected, please resubmit your dispute or contact your team leader! REASON: ${reason}`
      : '❗️Your dispute has been Rejected, please resubmit your dispute or contact your team leader!',
    type: 'alert',
    actionUrl: '/ca-portal/disputes',
  }),

  disputeCaApproved: (assignedToName: string): NotificationContent => ({
    title: 'Dispute Partially Approved',
    message: `${assignedToName} has approved your dispute! It will now be passed to your team leader for approval.`,
    type: 'success',
    actionUrl: '/ca-portal/disputes',
  }),

  disputeCaRejected: (assignedToName: string, reason?: string): NotificationContent => ({
    title: 'Dispute Rejected',
    message: reason
      ? `${assignedToName} has rejected your dispute! Please contact them privately to settle your dispute. REASON: ${reason}`
      : `${assignedToName} has rejected your dispute! Please contact them privately to settle your dispute.`,
    type: 'alert',
    actionUrl: '/ca-portal/disputes',
  }),

  // ─── Content planning ─────────────────────────────────────────────────────────
  contentPlanCompleted: (stageName: string, contentSummary: string): NotificationContent => ({
    title: '✅ Content Request Completed',
    message: `${stageName} has completed ${contentSummary}!`,
    type: 'success',
    actionUrl: '/creator-portal/content-planning',
  }),

  // ─── Model submissions ────────────────────────────────────────────────────────
  modelSubmissionReceived: (applicantName: string, location: string): NotificationContent => ({
    title: '🌟 New Model Application',
    message: `${applicantName} from ${location} has applied. Review their photos and details to approve or reject.`,
    type: 'action',
    actionUrl: '/applications/apps-model-submissions',
  }),

  // ─── OF Manager operations ────────────────────────────────────────────────────
  // Two diagnostics about the OnlyFans media cache. Both go to ONE named
  // operator rather than to a group, and both are sent ONCE EVER — see
  // `sendOpsAlertOnce` in `services/onlyfansOpsAlerts.ts`. They report a
  // standing condition that someone has to go and fix; repeating them would add
  // nothing after the first, and neither can un-fire once the fix lands.

  // The cache never deletes anything and it holds fans' media, so its size is a
  // retention question as much as a cost one. `periodLabel` is how long the
  // measured growth took — a figure that turns "it is 50 GB" into something you
  // can extrapolate from.
  ofMediaCacheCritical: (sizeLabel: string, periodLabel: string): NotificationContent => ({
    title: '⚠️ OnlyFans media cache needs a lifecycle rule',
    message: `Cached OnlyFans media in Cloud Storage has reached ${sizeLabel}, accumulated over ${periodLabel} of measurement. Nothing deletes it and it holds fans' media — set an age-based lifecycle rule on the onlyfans-media/ prefix to bound it. Sent once only.`,
    type: 'alert',
    actionUrl: null,
  }),

  // The single failure mode that would silently undo the largest media saving in
  // the app: renditions we cannot accept mean every video plays at source
  // resolution, which is billed by the megabyte.
  ofVideoSourceHostUnrecognised: (host: string): NotificationContent => ({
    title: '⚠️ OnlyFans video savings are not applying',
    message: `The provider is serving its 240p/720p video renditions from ${host}, which the app does not accept as a media host — so videos are falling back to the full-resolution source file, the most expensive download available. Allow that host in CDN_URL_PATTERN to restore the saving. Sent once only.`,
    type: 'alert',
    actionUrl: null,
  }),

  // ─── Desktop app releases ─────────────────────────────────────────────────────
  // Sent once to each user AFTER their installed build reaches the version in
  // APP_UPDATE.releaseNote — so it describes something they can already use, and
  // never reaches anyone still on the old build.
  //
  // ⚠️ THIS COPY IS PER-RELEASE. Rewrite the body every time you bump
  // APP_UPDATE.releaseNote.version, in the SAME commit. There is deliberately
  // one factory rather than one per release: the notification is once-off and
  // never re-sent, so last release's wording has no reader left to serve — but
  // that also means a bumped version with stale copy ships stale copy.
  releaseNote: (version: string): NotificationContent => ({
    title: `✨ What's new in v${version}`,
    message:
      'Your session timer now stays visible while the app is out of sight. Click it any time to jump straight back into the app. On Windows you can also drag it anywhere on screen if it covers something you need to see, and right-click it to snap it back to the corner.',
    type: 'system',
    actionUrl: null,
  }),
};

/**
 * ── Telegram bot copy ────────────────────────────────────────────────────────
 *
 * Messages the **bot** sends into a Telegram chat. They are not `notifications/`
 * documents — nothing renders them in the tray, and nothing catalogues them on
 * the Automated tab (cross-cutting rule 15 governs in-app notifications; these
 * are a different channel and listing them would misdescribe that tab).
 *
 * They live here anyway because rule 1 is about *copy*, not about storage: a
 * title typed into `telegramLinkService` or a webhook route is exactly the
 * scattering that rule exists to prevent.
 *
 * **These strings are Telegram HTML**, not plain text — the `<b>`/`<i>` tags are
 * intentional and are handed to `parse_mode: 'HTML'`. Anything interpolated must
 * be escaped by the caller (`escapeHtml` in `telegramService.ts`); the tokens
 * below are all names, which a user can control.
 */
export const telegramMessages = {
  /**
   * Sent to a creator the moment their Telegram account is bound. The trailing
   * "👇" points at the menu button the same handler installs — keep the two
   * together, or the message points at nothing.
   */
  creatorWelcome: (creatorName: string): string =>
    `🎉 <b>Welcome ${creatorName}!</b>\n\n` +
    'The Creator Portal can now easily be accessed via Telegram! ' +
    'See your custom requests, scheduled calls, and content requirements here 👇',

  /** Sent to an employee the moment their Telegram account is bound. */
  employeeWelcome: (): string =>
    '✅ <b>System Alerts Connected!</b>\n\n' +
    'Your Telegram account is now linked to your Bluu Backend account.\n\n' +
    'You will begin receiving real-time system alerts, status updates, and critical notifications in this chat.\n\n' +
    '<i>Note: This is an automated channel. Can be disabled in Bluu Backend settings.</i>',

  /**
   * The three ways `/start` can fail. Deliberately vague about *why* a token is
   * unusable — expired, spent and never-existed are one message, so a stranger
   * who guesses at the link cannot learn which tokens are real.
   */
  linkInvalid: (): string =>
    '⚠️ <b>This link is no longer valid.</b>\n\n' +
    'It may have expired or already been used. Ask your Bluu Rock contact for a new one.',

  linkConflict: (): string =>
    '⚠️ <b>This Telegram account is already linked to another Bluu Rock account.</b>\n\n' +
    'Disconnect it there first, or contact your Bluu Rock contact for help.',

  linkInactive: (): string =>
    '⚠️ <b>That account is not active.</b>\n\nPlease contact your Bluu Rock contact.',

  /**
   * `/start` with no payload from a Telegram account bound to **no** principal.
   *
   * It answers both audiences because at this point the bot genuinely cannot
   * tell which it is talking to — an unlinked chat has, by definition, nothing
   * on it identifying the sender. Saying "use your link" alone would strand
   * every employee, whose route in is the app rather than a link someone sends
   * them.
   *
   * A *linked* user pressing Start gets one of the two messages below instead;
   * telling a connected creator they are not connected is the failure this
   * split exists to prevent.
   */
  startWithoutToken: (): string =>
    '👋 <b>Welcome to Bluu Rock!</b>\n\n' +
    '⚠️ <i>It looks like you started this bot directly, so it is not currently linked to your profile.</i>\n\n' +
    '🎨 <b>If you are a Creator:</b>\n' +
    'Please use the personal link you were sent, or ask your Account Manager to generate a new one for you.\n\n' +
    '🏢 <b>If you are an Employee:</b>\n' +
    'Connect your Telegram account directly inside the Bluu Backend app settings, or ask your Team Leader for assistance.\n\n' +
    '📧 <b>Need Help?</b>\n' +
    'Send us an email at hello@bluurock.com',

  /** `/start` from a connected creator — reopening the chat, or tapping Start
   *  again. The 👇 points at the menu button the same branch re-installs. */
  startAlreadyLinkedCreator: (): string =>
    '✅ <b>You are connected.</b>\n\n' +
    'Open the Creator Portal below to see your custom requests, scheduled calls, and content requirements 👇',

  /** `/start` from a connected employee. No portal, so nothing to point at. */
  startAlreadyLinkedEmployee: (): string =>
    '✅ <b>You are connected.</b>\n\n' +
    'Your Bluu Backend alerts will arrive in this chat.\n\n' +
    '<i>You can disconnect at any time in Bluu Backend app settings.</i>',

  /**
   * ── Creator automated notifications ──────────────────────────────────────
   *
   * Creators have no in-app notification tray — Telegram is not an
   * *additional* channel for them, it is the only one (see telegram.md).
   * These four are automated (fired on an event, never sent by hand) and are
   * catalogued in `automatedNotifications.ts`'s dedicated Creators section,
   * a deliberate carve-out from the usual "bot copy is never catalogued"
   * rule — that rule exists because a bot message would misdescribe the
   * in-app Automated tab, but these entries have no in-app counterpart to be
   * confused with.
   *
   * Callers must pre-escape any interpolated value that is not already a
   * closed vocabulary (fan names are free text; call types, formatted
   * amounts and formatted dates are not) — same convention as the rest of
   * `telegramMessages`.
   */
  creatorNewCustomRequest: (fanName: string, totalAmount: string): string =>
    `📷 <b>New Custom Request</b>\n\n` +
    `You have a new custom request from ${fanName} for ${totalAmount}.\n\n` +
    `Don't keep them waiting! View the full details in the Creator Portal 👇`,

  creatorNewItemRequest: (fanName: string, totalAmount: string): string =>
    `👙 <b>New Item Request</b>\n\n` +
    `You have a new item request from ${fanName} for ${totalAmount}.\n\n` +
    `Don't keep them waiting! View the full details in the Creator Portal 👇`,

  creatorNewScheduledCall: (callType: string, fanName: string, date: string, totalAmount: string): string =>
    `📞 <b>New Scheduled Call</b>\n\n` +
    `You have a new scheduled ${callType} call with ${fanName} on ${date} for ${totalAmount}!\n\n` +
    `View the full details in the Creator Portal 👇`,

  /** No interpolation — the copy is the same for every creator every time. */
  creatorNewContentRequest: (): string =>
    `📽️ <b>New Content Request</b>\n\n` +
    `Your account manager needs more content to keep your account active.\n\n` +
    `View the full details in the Creator Portal 👇`,
};
