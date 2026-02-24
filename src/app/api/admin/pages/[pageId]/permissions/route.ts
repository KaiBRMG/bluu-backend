import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { getUserById } from '@/lib/services/userService';
import { updatePagePermissions } from '@/lib/services/pageService';
import { getAllGroups } from '@/lib/services/groupService';
import { getPageDef } from '@/lib/definitions';
import type { DecodedIdToken } from 'firebase-admin/auth';

/**
 * PUT /api/admin/pages/[pageId]/permissions
 * Admin-only. Updates permissions on a specific page.
 * Permissions are binary: { groups: { "CA": true }, users: { "uid123": true } }
 */
export const PUT = withAuth(async (
  request: NextRequest,
  token: DecodedIdToken,
  params: Promise<{ pageId: string }>
) => {
  try {
    // Verify caller is admin
    const caller = await getUserById(token.uid);
    if (!caller?.groups?.includes('admin')) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const { pageId } = await params;

    // Verify page exists in definitions
    if (!getPageDef(pageId)) {
      return NextResponse.json({ error: 'Page not found' }, { status: 404 });
    }

    const { permissions } = await request.json();

    if (!permissions || typeof permissions !== 'object') {
      return NextResponse.json({ error: 'Invalid permissions payload' }, { status: 400 });
    }

    // Validate group slugs exist
    if (permissions.groups && typeof permissions.groups === 'object') {
      const existingGroups = await getAllGroups();
      const validGroupIds = new Set(existingGroups.map((g: any) => g.id));

      for (const groupId of Object.keys(permissions.groups)) {
        if (!validGroupIds.has(groupId)) {
          return NextResponse.json({ error: `Unknown group: ${groupId}` }, { status: 400 });
        }
      }
    }

    await updatePagePermissions(pageId, {
      groups: permissions.groups || {},
      users: permissions.users || {},
    });

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error('Error updating page permissions:', error);
    const msg = error instanceof Error ? error.message : 'Failed to update permissions';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
});
