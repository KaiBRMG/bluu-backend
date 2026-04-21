import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { adminDb } from '@/lib/firebase-admin';

/**
 * GET /api/users/display-names
 * Returns uid + displayName for all internal users.
 */
export const GET = withAuth(async (_request: NextRequest) => {
  try {
    const snap = await adminDb.collection('users').select('displayName').get();
    const users = snap.docs.map(doc => ({
      uid: doc.id,
      displayName: (doc.data().displayName as string) ?? doc.id,
    }));
    return NextResponse.json({ users });
  } catch (error) {
    console.error('[users/display-names GET]', error);
    return NextResponse.json({ error: 'Failed to fetch users' }, { status: 500 });
  }
});
