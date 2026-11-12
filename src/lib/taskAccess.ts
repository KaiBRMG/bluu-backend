/**
 * Who may see and change a task, and what a valid task looks like.
 *
 * The single source of truth for the Tasks access rules — imported by the API
 * (the real gate) and by the page (which only uses it to decide which controls
 * to offer). Deliberately client-safe: no server-only imports. **The UI copy of
 * these checks is cosmetic; `/api/tasks` is the authority.**
 *
 * ```
 *                          admin        assignee           anyone else
 * see                      every task   their own          —
 * create                   for anyone   for themselves     —
 * edit own task            yes          yes                —
 * edit an ASSIGNED task    yes          status only        —
 * delete own task          yes          yes                —
 * delete an ASSIGNED task  yes          no                 —
 * reassign, blocksClockOut yes          no                 —
 * ```
 *
 * "Assigned" means someone else created it (`createdBy !== assigneeUid`) —
 * only an admin can create a task for another person, so that is exactly an
 * admin-set task. The assignee works it (moves its status); they don't rewrite
 * or remove what they were given.
 */
import {
  ONCE_OFF_STATUSES,
  ROLE_STATUSES,
  type TaskDocument,
  type TaskKind,
  type TaskStatus,
} from '@/types/task';

/** The caller, reduced to what access depends on. */
export interface TaskActor {
  uid: string;
  /** `token.admin` claim, or `admin` group membership — the same test Resources uses. */
  isAdmin: boolean;
}

export function buildTaskActor(
  uid: string,
  groups: string[] | undefined | null,
  hasAdminClaim: boolean
): TaskActor {
  return { uid, isAdmin: hasAdminClaim || (groups ?? []).includes('admin') };
}

type Ownership = Pick<TaskDocument, 'assigneeUid' | 'createdBy'>;

/** True when someone other than the assignee set this task. */
export function isAssignedTask(task: Ownership): boolean {
  return task.createdBy !== task.assigneeUid;
}

export function canReadTask(task: Ownership, actor: TaskActor): boolean {
  return actor.isAdmin || task.assigneeUid === actor.uid;
}

/** May change everything — title, body, kind, due date, status. */
export function canEditTask(task: Ownership, actor: TaskActor): boolean {
  if (actor.isAdmin) return true;
  return task.assigneeUid === actor.uid && !isAssignedTask(task);
}

export function canDeleteTask(task: Ownership, actor: TaskActor): boolean {
  return canEditTask(task, actor);
}

/**
 * The outcome of an authorization check against a STORED task. `not-found` is
 * returned for a task the caller cannot read — indistinguishable from a missing
 * id, so ids cannot be probed.
 */
export type TaskVerdict = 'ok' | 'forbidden' | 'not-found';

/**
 * May this actor apply a write touching `writtenKeys` to this stored task?
 * The one place the server's write rule lives (the routes only call it):
 *  - admin: anything;
 *  - a non-admin never sets `assigneeUid` or `blocksClockOut`;
 *  - on an admin-ASSIGNED task the assignee may send the status and nothing else
 *    — a refusal, not a silent strip.
 */
export function authorizeTaskUpdate(task: Ownership, writtenKeys: string[], actor: TaskActor): TaskVerdict {
  if (!canReadTask(task, actor)) return 'not-found';
  if (actor.isAdmin) return 'ok';
  if (writtenKeys.includes('assigneeUid') || writtenKeys.includes('blocksClockOut')) return 'forbidden';
  if (canEditTask(task, actor)) return 'ok';
  return writtenKeys.every(k => k === 'status') ? 'ok' : 'forbidden';
}

export function authorizeTaskDelete(task: Ownership, actor: TaskActor): TaskVerdict {
  if (!canReadTask(task, actor)) return 'not-found';
  return canDeleteTask(task, actor) ? 'ok' : 'forbidden';
}

/** Can this user doc be given a task? The same test the server and the picker use. */
export function isAssignableUser(u: { isActive?: boolean; isArchived?: boolean }): boolean {
  return u.isActive !== false && u.isArchived !== true;
}

/** Apply the read rule to a list — server-side, and again on the client's cache. */
export function filterVisibleTasks(tasks: TaskDocument[], actor: TaskActor): TaskDocument[] {
  return actor.isAdmin ? tasks : tasks.filter(t => canReadTask(t, actor));
}

// ─── Vocabulary ──────────────────────────────────────────────────────────────

export function statusesFor(kind: TaskKind): readonly TaskStatus[] {
  return kind === 'role' ? ROLE_STATUSES : ONCE_OFF_STATUSES;
}

export function defaultStatus(kind: TaskKind): TaskStatus {
  return kind === 'role' ? 'Active' : 'To do';
}

export function isValidStatus(kind: TaskKind, status: unknown): status is TaskStatus {
  return typeof status === 'string' && (statusesFor(kind) as readonly string[]).includes(status);
}

export function isTaskKind(v: unknown): v is TaskKind {
  return v === 'once-off' || v === 'role';
}

/**
 * The status a task carries after its kind changes. Each kind has its own
 * vocabulary, so a flip maps across rather than leaving a status that means
 * nothing for the new kind ("Done" on a role).
 */
export function remapStatus(status: TaskStatus, toKind: TaskKind): TaskStatus {
  if (isValidStatus(toKind, status)) return status;
  if (toKind === 'role') {
    if (status === 'Done') return 'Ended';
    if (status === 'Blocked') return 'Paused';
    return 'Active';
  }
  if (status === 'Ended') return 'Done';
  if (status === 'Paused') return 'Blocked';
  return 'In progress';
}

/**
 * Still owed, for the clock-out prompt. A once-off task is outstanding until it
 * is Done (Blocked and In progress still count); a role is outstanding while
 * Active — a Paused or Ended role is, by its status, not being asked of anyone.
 */
export function isOutstanding(task: Pick<TaskDocument, 'kind' | 'status'>): boolean {
  return task.kind === 'role' ? task.status === 'Active' : task.status !== 'Done';
}

/** Finished with: Done (a task) or Ended (a role). */
export function isClosedStatus(status: TaskStatus): boolean {
  return status === 'Done' || status === 'Ended';
}

export function isClosed(task: Pick<TaskDocument, 'status'>): boolean {
  return isClosedStatus(task.status);
}

/** "14 Nov" from a `YYYY-MM-DD` calendar date — formatted from its parts, never through a zone. */
export function formatDue(due: string): string {
  const [y, m, d] = due.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** `YYYY-MM-DD` that is a real calendar date. */
export function isValidDueDate(v: unknown): v is string {
  if (typeof v !== 'string' || !DATE_RE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}
