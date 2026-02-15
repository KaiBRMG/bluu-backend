import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/lib/firebase-admin';
import { getUserById } from '@/lib/services/userService';
import { getAllGroups } from '@/lib/services/groupService';

/**
 * GET /api/admin/users
 * Admin-only. Returns all users with full document data and all groups.
 */
export async function GET(request: NextRequest) {
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
    const errorCode = (error as { code?: string })?.code;
    if (errorCode === 'auth/id-token-expired') {
      return NextResponse.json({ error: 'Session expired' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Failed to fetch users' }, { status: 500 });
  }
}
