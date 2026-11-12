import { NextRequest, NextResponse, after } from 'next/server';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { withAuth } from '@/lib/middleware/withAuth';
import { handleApiError } from '@/lib/middleware/apiHelpers';
import { getUserById } from '@/lib/services/userService';
import {
  NO_STORE,
  attachCreatorNames,
  deleteTask,
  isAssignable,
  nameOf,
  parseTaskWrite,
  updateTask,
} from '@/lib/services/taskService';
import { notifyUsers } from '@/lib/services/caNotifications';
import { notifications } from '@/lib/notificationContent';
import { authorizeTaskDelete, authorizeTaskUpdate, buildTaskActor } from '@/lib/taskAccess';

/** A 404 for a task the caller cannot read (see `TaskVerdict`), a 403 for one they can but may not change. */
const refuse = (reason: 'not-found' | 'forbidden') =>
  NextResponse.json(
    { error: reason === 'not-found' ? 'Task not found' : 'Access denied' },
    { status: reason === 'not-found' ? 404 : 403 }
  );

/**
 * PUT /api/tasks/[id]
 * Authorised against the LIVE stored task inside the write's own transaction —
 * the rules are `authorizeTaskUpdate` in `lib/taskAccess.ts`. When an admin moves
 * a task onto someone else, that person is notified.
 */
export const PUT = withAuth(async (
  req: NextRequest,
  token: DecodedIdToken,
  params: Promise<{ id: string }>
) => {
  try {
    const [{ id }, caller, body] = await Promise.all([
      params,
      getUserById(token.uid),
      req.json().catch(() => null),
    ]);
    const actor = buildTaskActor(token.uid, caller?.groups, token.admin === true);

    const parsed = parseTaskWrite(body, { partial: true });
    if (!parsed.ok) return NextResponse.json({ error: parsed.message }, { status: 400 });
    const w = parsed.write;

    if (actor.isAdmin && w.assigneeUid && w.assigneeUid !== token.uid && !(await isAssignable(w.assigneeUid))) {
      return NextResponse.json({ error: 'That person cannot be given tasks' }, { status: 400 });
    }

    const keys = Object.keys(w);
    const result = await updateTask(id, w, existing => authorizeTaskUpdate(existing, keys, actor));
    if (!result.ok) {
      return result.reason === 'invalid'
        ? NextResponse.json({ error: result.message ?? 'Invalid task' }, { status: 400 })
        : refuse(result.reason);
    }

    const { task, previous } = result.value;
    if (actor.isAdmin && task.assigneeUid !== previous.assigneeUid && task.assigneeUid !== token.uid) {
      after(() =>
        notifyUsers([task.assigneeUid], notifications.taskAssigned(task.title, task.kind, nameOf(caller) ?? 'An admin'), {
          label: 'task assignment',
        })
      );
    }
    const [named] = await attachCreatorNames([task], new Map([[token.uid, nameOf(caller)]]));
    return NextResponse.json({ task: named }, { headers: NO_STORE });
  } catch (err) {
    return handleApiError(err, 'tasks PUT');
  }
});

/** DELETE /api/tasks/[id] — an admin, or the assignee of a task they made themselves. */
export const DELETE = withAuth(async (
  _req: NextRequest,
  token: DecodedIdToken,
  params: Promise<{ id: string }>
) => {
  try {
    const [{ id }, caller] = await Promise.all([params, getUserById(token.uid)]);
    const actor = buildTaskActor(token.uid, caller?.groups, token.admin === true);
    const result = await deleteTask(id, existing => authorizeTaskDelete(existing, actor));
    if (!result.ok) return refuse(result.reason === 'invalid' ? 'forbidden' : result.reason);
    return NextResponse.json({ success: true }, { headers: NO_STORE });
  } catch (err) {
    return handleApiError(err, 'tasks DELETE');
  }
});
