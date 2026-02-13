import { NextRequest, NextResponse } from 'next/server';
import { adminAuth } from '@/lib/firebase-admin';
import { getUserById } from '@/lib/services/userService';
import { ensureDefaultGroups } from '@/lib/services/groupService';
import { seedDefaultTeamspaces } from '@/lib/services/teamspaceService';
import { seedDefaultPages } from '@/lib/services/pageService';

/**
 * POST /api/admin/seed
 * Admin-only. Seeds default groups, teamspaces, and pages. Idempotent.
 */
export async function POST(request: NextRequest) {
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

    // Seed in order: groups first (pages reference group slugs), then teamspaces, then pages
    await ensureDefaultGroups();
    await seedDefaultTeamspaces();
    await seedDefaultPages();

    return NextResponse.json({ success: true, message: 'Seed completed' });
  } catch (error: unknown) {
    console.error('Error seeding data:', error);
    const errorCode = (error as { code?: string })?.code;
    if (errorCode === 'auth/id-token-expired') {
      return NextResponse.json({ error: 'Session expired' }, { status: 401 });
    }
    const msg = error instanceof Error ? error.message : 'Failed to seed data';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
