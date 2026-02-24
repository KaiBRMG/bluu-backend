import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { getUserById } from '@/lib/services/userService';
import { ensureDefaultGroups } from '@/lib/services/groupService';
import { seedDefaultPagePermissions } from '@/lib/services/pageService';
import type { DecodedIdToken } from 'firebase-admin/auth';

/**
 * POST /api/admin/init
 * One-time idempotent seed: creates default groups and page-permissions.
 * Admin-only. Safe to call multiple times — existing docs are skipped.
 */
export const POST = withAuth(async (request: NextRequest, token: DecodedIdToken) => {
  try {
    const caller = await getUserById(token.uid);
    if (!caller?.groups?.includes('admin')) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    await Promise.all([
      ensureDefaultGroups(),
      seedDefaultPagePermissions(),
    ]);

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error('[admin/init] Error:', error);
    return NextResponse.json({ error: 'Initialization failed' }, { status: 500 });
  }
});
