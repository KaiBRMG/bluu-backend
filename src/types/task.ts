/**
 * Tasks — shared, client-safe types for the `tasks` collection.
 * See documentation/tasks.md.
 */

/** A once-off task finishes; a role is a standing responsibility that never does. */
export type TaskKind = 'once-off' | 'role';

export const ONCE_OFF_STATUSES = ['To do', 'In progress', 'Blocked', 'Done'] as const;
export const ROLE_STATUSES = ['Active', 'Paused', 'Ended'] as const;

export type OnceOffStatus = (typeof ONCE_OFF_STATUSES)[number];
export type RoleStatus = (typeof ROLE_STATUSES)[number];
export type TaskStatus = OnceOffStatus | RoleStatus;

/** Limits, enforced on the server and mirrored in the form. */
export const TASK_TITLE_MAX = 200;
export const TASK_TEXT_MAX = 20_000;

/** One task, as the API returns it. */
export interface TaskDocument {
  id: string;
  title: string;
  /** Plain-text projection of the body. Canonical — derived server-side from `textHtml`. */
  text: string;
  /** The body in the rich-text dialect (`lib/promptHtml.ts`), or null when plain. */
  textHtml: string | null;
  kind: TaskKind;
  status: TaskStatus;
  /** The one person this task belongs to. */
  assigneeUid: string;
  /** Who created it. `createdBy !== assigneeUid` means an admin assigned it. */
  createdBy: string;
  /**
   * The creator's display name, resolved server-side — only on an assigned task,
   * so an assignee who cannot read the staff directory still sees who set it.
   */
  createdByName: string | null;
  /** `YYYY-MM-DD`, once-off tasks only. A calendar date, not an instant. */
  dueDate: string | null;
  /**
   * Admin-set. While the task is outstanding (`isOutstanding`) the assignee is
   * asked to confirm before clocking out. A nudge, never a lock — "Clock Out
   * Anyway" is always there. Only an admin can set or clear it.
   */
  blocksClockOut: boolean;
  /** ISO — when a once-off task last reached Done; null otherwise. */
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** What a client may send on create / update. Everything else is server-derived. */
export interface TaskPayload {
  title: string;
  textHtml: string;
  kind: TaskKind;
  status: TaskStatus;
  dueDate: string | null;
  /** Honoured for admins only — a non-admin sending `true` is refused. */
  blocksClockOut?: boolean;
  /** Honoured for admins only. A non-admin's task is always their own. */
  assigneeUid?: string;
}

/** What the clock-out prompt needs to name an outstanding task — nothing more. */
export type BlockingTask = Pick<TaskDocument, 'id' | 'title' | 'kind' | 'status' | 'dueDate'>;
