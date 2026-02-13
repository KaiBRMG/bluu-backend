import { NextRequest, NextResponse } from 'next/server';
import { adminAuth } from '@/lib/firebase-admin';
import { getUserById } from '@/lib/services/userService';
import { getPageById, updatePagePermissions } from '@/lib/services/pageService';
import { getAllGroups } from '@/lib/services/groupService';
import type { PermissionRole } from '@/types/firestore';

/**
 * PUT /api/admin/pages/[pageId]/permissions
 * Admin-only. Updates permissions on a specific page.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ pageId: string }> }
) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Missing authorization token' }, { status: 401 });
    }

    const idToken = authHeader.split('Bearer ')[1];
    const decodedToken = await adminAuth.verifyIdToken(idToken);
    const uid = decodedToken.uid;

    // Verify caller is admin
    const caller = await getUserById(uid);
    if (!caller?.groups?.includes('admin')) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const { pageId } = await params;

    // Verify page exists
    const page = await getPageById(pageId);
    if (!page) {
      return NextResponse.json({ error: 'Page not found' }, { status: 404 });
    }

    const { permissions } = await request.json();

    if (!permissions || typeof permissions !== 'object') {
      return NextResponse.json({ error: 'Invalid permissions payload' }, { status: 400 });
    }

    // Validate structure
    const validRoles: PermissionRole[] = ['full_access', 'can_edit', 'can_view'];

    if (permissions.users && typeof permissions.users === 'object') {
      for (const [, role] of Object.entries(permissions.users)) {
        if (!validRoles.includes(role as PermissionRole)) {
          return NextResponse.json({ error: `Invalid user permission role: ${role}` }, { status: 400 });
        }
      }
    }

    if (permissions.groups && typeof permissions.groups === 'object') {
      // Validate group slugs exist
      const existingGroups = await getAllGroups();
      const validGroupIds = new Set(existingGroups.map((g: any) => g.id));

      for (const [groupId, role] of Object.entries(permissions.groups)) {
        if (!validGroupIds.has(groupId)) {
          return NextResponse.json({ error: `Unknown group: ${groupId}` }, { status: 400 });
        }
        if (!validRoles.includes(role as PermissionRole)) {
          return NextResponse.json({ error: `Invalid group permission role: ${role}` }, { status: 400 });
        }
      }
    }

    await updatePagePermissions(pageId, {
      users: permissions.users || {},
      groups: permissions.groups || {},
    });

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error('Error updating page permissions:', error);
    const errorCode = (error as { code?: string })?.code;
    if (errorCode === 'auth/id-token-expired') {
      return NextResponse.json({ error: 'Session expired' }, { status: 401 });
    }
    const msg = error instanceof Error ? error.message : 'Failed to update permissions';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
