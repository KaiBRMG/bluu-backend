import { STATUS_COLORS } from '@/lib/campaignTracking';
import type { TaskStatus } from '@/types/task';

/**
 * Pill colours for task statuses. Every hue is BORROWED from `STATUS_COLORS`
 * (the way `disputeStatus.ts` does) — no hex or class is typed here, so a change
 * to the status palette reaches Tasks too. Orange waits on something, blue is
 * moving, green is finished, zinc is not started or over.
 */
export const TASK_STATUS_COLORS: Record<TaskStatus, string> = {
  'To do': STATUS_COLORS['Archived'],
  'In progress': STATUS_COLORS['In Progress'],
  'Blocked': STATUS_COLORS['Awaiting Approval'],
  'Done': STATUS_COLORS['Completed'],
  'Active': STATUS_COLORS['In Progress'],
  'Paused': STATUS_COLORS['Awaiting Approval'],
  'Ended': STATUS_COLORS['Archived'],
};
