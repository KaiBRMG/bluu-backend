import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { getUserById } from '@/lib/services/userService';
import { getAllResources, createResource } from '@/lib/services/resourceService';
import type { DecodedIdToken } from 'firebase-admin/auth';

const PAGE_ID = 'admin-resource-management';

async function isAuthorized(token: DecodedIdToken): Promise<boolean> {
  if (token.admin === true) return true;
  const caller = await getUserById(token.uid);
  return caller?.permittedPageIds?.includes(PAGE_ID) === true;
}

/**
 * GET /api/admin/resources
 * Resource-manager only. Returns every resource (any status) for management.
 */
export const GET = withAuth(async (_req: NextRequest, token: DecodedIdToken) => {
  try {
    if (!(await isAuthorized(token))) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }
    const documents = await getAllResources();
    return NextResponse.json({ documents });
  } catch (err) {
    console.error('[admin/resources GET]', err);
    return NextResponse.json({ error: 'Failed to fetch resources' }, { status: 500 });
  }
});

/**
 * POST /api/admin/resources
 * Resource-manager only. Creates a new resource document.
 */
export const POST = withAuth(async (req: NextRequest, token: DecodedIdToken) => {
  try {
    if (!(await isAuthorized(token))) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }
    const body = await req.json();
    if (!body?.name || typeof body.name !== 'string' || !body.name.trim()) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 });
    }
    const doc = await createResource(body);
    return NextResponse.json({ document: doc }, { status: 201 });
  } catch (err) {
    console.error('[admin/resources POST]', err);
    return NextResponse.json({ error: 'Failed to create resource' }, { status: 500 });
  }
});
