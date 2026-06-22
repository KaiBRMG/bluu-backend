import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { adminDb } from '@/lib/firebase-admin';

/**
 * GET /api/disputes/users
 * Returns all users in the 'CA' group (uid + displayName only).
 * Used in both the disputes (assignee picker) and ca-admin (filter dropdown) contexts.
 */
export const GET = withAuth(async (_request: NextRequest) => {
  try {
    const snap = await adminDb.collection('users').where('groups', 'array-contains', 'CA').get();
    const users = snap.docs
      .filter(doc => doc.data().isArchived !== true)
      .map(doc => ({
        uid: doc.id,
        displayName: doc.data().displayName as string,
      })).sort((a, b) => a.displayName.localeCompare(b.displayName));

    return NextResponse.json({ users });
  } catch (error) {
    console.error('[disputes/users GET]', error);
    return NextResponse.json({ error: 'Failed to fetch users' }, { status: 500 });
  }
});
