import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { getUserById } from '@/lib/services/userService';
import { ensureDefaultGroups } from '@/lib/services/groupService';
import { seedDefaultPagePermissions } from '@/lib/services/pageService';
import type { DecodedIdToken } from 'firebase-admin/auth';

/**
 * POST /api/admin/seed
 * Admin-only. Seeds default groups and page-permissions. Idempotent.
 * No longer seeds teamspace or page documents (those are code constants).
 */
export const POST = withAuth(async (request: NextRequest, token: DecodedIdToken) => {
  try {
    // Verify caller is admin
    const caller = await getUserById(token.uid);
    if (!caller?.groups?.includes('admin')) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    // Seed groups first, then page-permissions (which reference group IDs)
    await ensureDefaultGroups();
    await seedDefaultPagePermissions();

    return NextResponse.json({ success: true, message: 'Seed completed' });
  } catch (error: unknown) {
    console.error('[admin/seed] error:', error);
    return NextResponse.json({ error: 'Failed to seed data' }, { status: 500 });
  }
});
