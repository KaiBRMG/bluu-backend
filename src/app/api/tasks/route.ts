import { NextRequest, NextResponse, after } from 'next/server';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { withAuth } from '@/lib/middleware/withAuth';
import { handleApiError } from '@/lib/middleware/apiHelpers';
import { getUserById } from '@/lib/services/userService';
import {
  NO_STORE,
  attachCreatorNames,
  createTask,
  getTasks,
  isAssignable,
  nameOf,
  parseTaskWrite,
} from '@/lib/services/taskService';
import { notifyUsers } from '@/lib/services/caNotifications';
import { notifications } from '@/lib/notificationContent';
import { buildTaskActor } from '@/lib/taskAccess';

/**
 * Cache-Control: no-store, deliberately (rule 9i). A per-user response can only
 * be cached by the browser, and the page patches its own state after every write
 * instead of refetching — a browser-cached list would hand a refetch the copy
 * from BEFORE the write, so an edit would look like it did not save.
 */

/**
 * GET /api/tasks
 * An admin gets every task; everyone else gets their own. The page's Mine /
 * Everyone switch is a client-side filter over what an admin is sent.
 */
export const GET = withAuth(async (_req: NextRequest, token: DecodedIdToken) => {
  try {
    const caller = await getUserById(token.uid);
    const actor = buildTaskActor(token.uid, caller?.groups, token.admin === true);
    const tasks = await getTasks(actor.isAdmin ? 'all' : { assigneeUid: token.uid });
    return NextResponse.json(
      { tasks: await attachCreatorNames(tasks, new Map([[token.uid, nameOf(caller)]])) },
      { headers: NO_STORE }
    );
  } catch (err) {
    return handleApiError(err, 'tasks GET');
  }
});

/**
 * POST /api/tasks
 * A non-admin creates for themselves only: `assigneeUid` is forced to the caller
 * and `blocksClockOut` is refused. An admin may create for any active employee,
 * who is then notified.
 */
export const POST = withAuth(async (req: NextRequest, token: DecodedIdToken) => {
  try {
    const caller = await getUserById(token.uid);
    const actor = buildTaskActor(token.uid, caller?.groups, token.admin === true);

    const parsed = parseTaskWrite(await req.json().catch(() => null), { partial: false });
    if (!parsed.ok) return NextResponse.json({ error: parsed.message }, { status: 400 });
    const w = parsed.write;

    let assigneeUid = token.uid;
    if (actor.isAdmin) {
      assigneeUid = w.assigneeUid ?? token.uid;
      if (assigneeUid !== token.uid && !(await isAssignable(assigneeUid))) {
        return NextResponse.json({ error: 'That person cannot be given tasks' }, { status: 400 });
      }
    } else if (w.blocksClockOut || (w.assigneeUid && w.assigneeUid !== token.uid)) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const result = await createTask(
      { ...w, title: w.title!, kind: w.kind!, assigneeUid, blocksClockOut: actor.isAdmin && w.blocksClockOut },
      token.uid
    );
    if (!result.ok) {
      return NextResponse.json({ error: result.message ?? 'Invalid task' }, { status: 400 });
    }
    const task = result.value;
    if (assigneeUid !== token.uid) {
      after(() =>
        notifyUsers([assigneeUid], notifications.taskAssigned(task.title, task.kind, nameOf(caller) ?? 'An admin'), {
          label: 'task assignment',
        })
      );
    }
    const [named] = await attachCreatorNames([task], new Map([[token.uid, nameOf(caller)]]));
    return NextResponse.json({ task: named }, { status: 201, headers: NO_STORE });
  } catch (err) {
    return handleApiError(err, 'tasks POST');
  }
});
