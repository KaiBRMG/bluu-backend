import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { adminDb } from '@/lib/firebase-admin';

/**
 * GET /api/creators
 * Returns non-archived creators sorted alphabetically by stageName.
 * Used across the employee-facing app wherever creator names/avatars are shown.
 *
 * Visibility on the employee side is governed by `isArchived` only. `isActive`
 * solely controls whether the creator can log into their own creator portal, so
 * a merely-deactivated (but not archived) creator's data must still appear here.
 */
export const GET = withAuth(async (_request: NextRequest) => {
  try {
    const snap = await adminDb
      .collection('creators')
      .select('creatorID', 'stageName', 'defaultTimezone', 'isArchived', 'photoURL')
      .get();
    const creators = snap.docs
      .map(doc => ({
        creatorID: doc.data().creatorID as string,
        stageName: doc.data().stageName as string,
        defaultTimezone: (doc.data().defaultTimezone as string | undefined) ?? undefined,
        isArchived: (doc.data().isArchived as boolean | undefined) ?? false,
        photoURL: (doc.data().photoURL as string | null | undefined) ?? null,
      }))
      .filter(c => c.isArchived !== true)
      .sort((a, b) => a.stageName.localeCompare(b.stageName));

    return NextResponse.json({ creators });
  } catch (error) {
    console.error('[creators GET]', error);
    return NextResponse.json({ error: 'Failed to fetch creators' }, { status: 500 });
  }
});
