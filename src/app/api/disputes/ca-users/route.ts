import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { adminDb } from '@/lib/firebase-admin';

/**
 * GET /api/disputes/ca-users
 * Returns all users in the 'CA' group (uid + displayName only).
 */
export const GET = withAuth(async (_request: NextRequest) => {
  try {
    const snap = await adminDb.collection('users').where('groups', 'array-contains', 'CA').get();
    const users = snap.docs.map(doc => ({
      uid: doc.id,
      displayName: doc.data().displayName as string,
    })).sort((a, b) => a.displayName.localeCompare(b.displayName));

    return NextResponse.json({ users });
  } catch (error) {
    console.error('[disputes/ca-users GET]', error);
    return NextResponse.json({ error: 'Failed to fetch CA users' }, { status: 500 });
  }
});
