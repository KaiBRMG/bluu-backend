import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { getUserById } from '@/lib/services/userService';
import { updateResource, deleteResource } from '@/lib/services/resourceService';
import {
  buildResourceActor,
  canWriteGroups,
  canWriteResource,
  type ResourceActor,
} from '@/lib/resourceAccess';
import type { DecodedIdToken } from 'firebase-admin/auth';

async function actorFor(token: DecodedIdToken): Promise<ResourceActor> {
  const caller = await getUserById(token.uid);
  return buildResourceActor(token.uid, caller?.groups, token.admin === true);
}

/**
 * PUT /api/resources/[id]
 * Edits a resource. Authorised against the **stored** groups and, when the edit
 * changes them, against the incoming ones too — otherwise a manager could
 * re-tag a resource into a scope they cannot write and keep editing it.
 */
export const PUT = withAuth(async (
  req: NextRequest,
  token: DecodedIdToken,
  params: Promise<{ id: string }>
) => {
  try {
    const [{ id }, actor, body] = await Promise.all([params, actorFor(token), req.json()]);

    if (body?.name !== undefined && (typeof body.name !== 'string' || !body.name.trim())) {
      return NextResponse.json({ error: 'Name cannot be empty' }, { status: 400 });
    }

    const nextGroups: string[] | undefined = Array.isArray(body?.groups)
      ? body.groups.filter((g: unknown): g is string => typeof g === 'string')
      : undefined;
    if (nextGroups !== undefined && !canWriteGroups(nextGroups, actor)) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const payload = nextGroups !== undefined ? { ...body, groups: nextGroups } : body;
    const result = await updateResource(id, payload, existing =>
      canWriteResource(existing, actor)
    );

    if (!result.ok) {
      return result.reason === 'not-found'
        ? NextResponse.json({ error: 'Resource not found' }, { status: 404 })
        : NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }
    return NextResponse.json({ document: result.value });
  } catch (err) {
    console.error('[resources PUT]', err);
    return NextResponse.json({ error: 'Failed to update resource' }, { status: 500 });
  }
});

/**
 * DELETE /api/resources/[id]
 * Deletes a resource the caller is allowed to manage.
 */
export const DELETE = withAuth(async (
  _req: NextRequest,
  token: DecodedIdToken,
  params: Promise<{ id: string }>
) => {
  try {
    const [{ id }, actor] = await Promise.all([params, actorFor(token)]);
    const result = await deleteResource(id, existing => canWriteResource(existing, actor));

    if (!result.ok) {
      return result.reason === 'not-found'
        ? NextResponse.json({ error: 'Resource not found' }, { status: 404 })
        : NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[resources DELETE]', err);
    return NextResponse.json({ error: 'Failed to delete resource' }, { status: 500 });
  }
});
