import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { adminDb } from '@/lib/firebase-admin';
import { getUserById } from '@/lib/services/userService';
import { getAllGroups } from '@/lib/services/groupService';
import type { DecodedIdToken } from 'firebase-admin/auth';

/**
 * GET /api/admin/users
 * Admin-only. Returns all users with full document data and all groups.
 */
export const GET = withAuth(async (request: NextRequest, token: DecodedIdToken) => {
  try {
    // Verify caller is admin
    const caller = await getUserById(token.uid);
    if (!caller?.groups?.includes('admin')) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    // Fetch all users and groups in parallel
    const [usersSnapshot, groups] = await Promise.all([
      adminDb.collection('users').get(),
      getAllGroups(),
    ]);

    const users = usersSnapshot.docs.map(doc => {
      const data = doc.data();
      return {
        ...data,
        // Serialize Timestamps to ISO strings for JSON transport
        createdAt: data.createdAt?.toDate?.()?.toISOString() ?? null,
        lastLoginAt: data.lastLoginAt?.toDate?.()?.toISOString() ?? null,
        DOB: data.DOB?.toDate?.()?.toISOString() ?? null,
      };
    });

    return NextResponse.json({ users, groups });
  } catch (error: unknown) {
    console.error('Error fetching admin users:', error);
    return NextResponse.json({ error: 'Failed to fetch users' }, { status: 500 });
  }
});
