import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { adminDb } from '@/lib/firebase-admin';
import { checkSmmAccess } from '@/lib/services/smmService';
import type { DecodedIdToken } from 'firebase-admin/auth';

/**
 * GET /api/smm/users
 * Returns all non-archived users in the 'SMM' group (uid + displayName +
 * photoURL). Used by the admin Account Database 'assigned' picker.
 */
export const GET = withAuth(async (_request: NextRequest, token: DecodedIdToken) => {
  try {
    const denied = await checkSmmAccess(token.uid, 'admin');
    if (denied) return denied;

    const snap = await adminDb.collection('users').where('groups', 'array-contains', 'SMM').get();
    const users = snap.docs
      .filter((doc) => doc.data().isArchived !== true)
      .map((doc) => ({
        uid: doc.id,
        displayName: (doc.data().displayName as string) ?? '',
        photoURL: (doc.data().photoURL as string) ?? null,
      }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName));

    return NextResponse.json({ users });
  } catch (error) {
    console.error('[GET /api/smm/users]', error);
    return NextResponse.json({ error: 'Failed to fetch users' }, { status: 500 });
  }
});
