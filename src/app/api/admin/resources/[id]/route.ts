import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { getUserById } from '@/lib/services/userService';
import { updateResource, deleteResource } from '@/lib/services/resourceService';
import type { DecodedIdToken } from 'firebase-admin/auth';

const PAGE_ID = 'admin-resource-management';

async function isAuthorized(token: DecodedIdToken): Promise<boolean> {
  if (token.admin === true) return true;
  const caller = await getUserById(token.uid);
  return caller?.permittedPageIds?.includes(PAGE_ID) === true;
}

/**
 * PUT /api/admin/resources/[id]
 * Resource-manager only. Updates an existing resource document.
 */
export const PUT = withAuth(async (
  req: NextRequest,
  token: DecodedIdToken,
  params: Promise<{ id: string }>
) => {
  try {
    if (!(await isAuthorized(token))) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }
    const { id } = await params;
    const body = await req.json();
    if (body?.name !== undefined && (typeof body.name !== 'string' || !body.name.trim())) {
      return NextResponse.json({ error: 'Name cannot be empty' }, { status: 400 });
    }
    const doc = await updateResource(id, body);
    if (!doc) {
      return NextResponse.json({ error: 'Resource not found' }, { status: 404 });
    }
    return NextResponse.json({ document: doc });
  } catch (err) {
    console.error('[admin/resources PUT]', err);
    return NextResponse.json({ error: 'Failed to update resource' }, { status: 500 });
  }
});

/**
 * DELETE /api/admin/resources/[id]
 * Resource-manager only. Deletes a resource document.
 */
export const DELETE = withAuth(async (
  _req: NextRequest,
  token: DecodedIdToken,
  params: Promise<{ id: string }>
) => {
  try {
    if (!(await isAuthorized(token))) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }
    const { id } = await params;
    const ok = await deleteResource(id);
    if (!ok) {
      return NextResponse.json({ error: 'Resource not found' }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[admin/resources DELETE]', err);
    return NextResponse.json({ error: 'Failed to delete resource' }, { status: 500 });
  }
});
