import { NextRequest, NextResponse } from 'next/server';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { withAuth } from '@/lib/middleware/withAuth';
import { handleApiError } from '@/lib/middleware/apiHelpers';
import { getUserById } from '@/lib/services/userService';
import { NO_STORE, getBlockingTasks } from '@/lib/services/taskService';
import { buildTaskActor } from '@/lib/taskAccess';

/**
 * GET /api/tasks/blocking
 * The caller's outstanding tasks that an admin has marked as blocking clock-out —
 * just enough to name them in the prompt. Called when the Clock Out button is
 * pressed, so it must be live: `no-store`, never a cached answer about work that
 * may have been finished a moment ago.
 *
 * Admins always get an empty list: the prompt is for the people tasks are
 * assigned TO. This is the one place that rule lives; the client does not repeat it.
 */
export const GET = withAuth(async (_req: NextRequest, token: DecodedIdToken) => {
  try {
    const caller = await getUserById(token.uid);
    const actor = buildTaskActor(token.uid, caller?.groups, token.admin === true);
    return NextResponse.json(
      { tasks: actor.isAdmin ? [] : await getBlockingTasks(token.uid) },
      { headers: NO_STORE }
    );
  } catch (err) {
    return handleApiError(err, 'tasks/blocking GET');
  }
});
