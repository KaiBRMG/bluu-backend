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
  welcomeToTeam: (firstName: string): NotificationContent => ({
    title: 'Welcome to Bluu Rock!',
    message: `Hi ${firstName}, welcome to the team! You will be assigned to a group soon.`,
    type: 'success',
    actionUrl: null,
  }),

  adminNewUserAlert: (): NotificationContent => ({
    title: 'Action Required',
    message: 'A new user has logged in, assign them to a group asap to complete onboarding.',
    type: 'action',
    actionUrl: '/admin/user-management',
  }),

  // ─── Custom requests ──────────────────────────────────────────────────────────
  crCreated: (creatorName: string, stageName: string): NotificationContent => ({
    title: '📷 A New CR has been Created!',
    message: `${creatorName} has added a new CR for ${stageName}. Review the details and approve ASAP!`,
    type: 'action',
    actionUrl: '/creators/custom-requests',
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
    actionUrl: '/creators/custom-requests',
  }),

  crTransferred: (transferrerName: string, creatorName: string, actionUrl: string): NotificationContent => ({
    title: '🔄 Custom Transferred to You',
    message: `❗${transferrerName} transferred a custom on ${creatorName} to you. You are now responsible for following up the fan, collecting the remaining balance, and completing the request.`,
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
    actionUrl: '/creators/content-planning',
  }),
};
