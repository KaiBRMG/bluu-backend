import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { getUserById } from '@/lib/services/userService';
import { getAllResources, createResource } from '@/lib/services/resourceService';
import {
  buildResourceActor,
  canWriteGroups,
  filterVisibleResources,
  type ResourceActor,
} from '@/lib/resourceAccess';
import type { DecodedIdToken } from 'firebase-admin/auth';

/**
 * The caller's access identity. One cached user read (`getUserById`) serves both
 * the read filter and the write check — see the matrix in `resourceAccess.ts`.
 */
async function actorFor(token: DecodedIdToken): Promise<ResourceActor> {
  const caller = await getUserById(token.uid);
  return buildResourceActor(token.uid, caller?.groups, token.admin === true);
}

/**
 * GET /api/resources
 * Every resource the caller may see: Active ones within their read scope, plus
 * any resource they can manage regardless of status (that is how `Unlisted`
 * reaches the managers who need to act on it).
 */
export const GET = withAuth(async (_req: NextRequest, token: DecodedIdToken) => {
  try {
    const [all, actor] = await Promise.all([getAllResources(), actorFor(token)]);
    return NextResponse.json({ documents: filterVisibleResources(all, actor) });
  } catch (err) {
    console.error('[resources GET]', err);
    return NextResponse.json({ error: 'Failed to fetch resources' }, { status: 500 });
  }
});

/**
 * POST /api/resources
 * Creates a resource. The caller must be able to write **every** group they tag
 * it with, so a manager cannot create something outside their own scope.
 */
export const POST = withAuth(async (req: NextRequest, token: DecodedIdToken) => {
  try {
    const actor = await actorFor(token);
    const body = await req.json();

    if (!body?.name || typeof body.name !== 'string' || !body.name.trim()) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 });
    }

    const groups: string[] = Array.isArray(body.groups)
      ? body.groups.filter((g: unknown): g is string => typeof g === 'string')
      : [];
    if (!canWriteGroups(groups, actor)) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const doc = await createResource({ ...body, groups });
    return NextResponse.json({ document: doc }, { status: 201 });
  } catch (err) {
    console.error('[resources POST]', err);
    return NextResponse.json({ error: 'Failed to create resource' }, { status: 500 });
  }
});
