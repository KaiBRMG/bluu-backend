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
 *
 * `photoThumb` is a 64px WebP `data:` URI (a couple of KB each) and is why this
 * response is deliberately chunkier than it looks: inlining the avatars here is
 * what lets a thirty-avatar shift calendar render without issuing thirty image
 * requests to Firebase Storage. The roster is fetched once per app session and
 * cached in `sessionStorage` by `useCreators`, so it is paid for once and the
 * avatars arrive free with it.
 */
export const GET = withAuth(async (_request: NextRequest) => {
  try {
    const snap = await adminDb
      .collection('creators')
      .select('creatorID', 'stageName', 'defaultTimezone', 'isArchived', 'photoURL', 'photoThumb')
      .get();
    const creators = snap.docs
      .map(doc => ({
        creatorID: doc.data().creatorID as string,
        stageName: doc.data().stageName as string,
        defaultTimezone: (doc.data().defaultTimezone as string | undefined) ?? undefined,
        isArchived: (doc.data().isArchived as boolean | undefined) ?? false,
        photoURL: (doc.data().photoURL as string | null | undefined) ?? null,
        photoThumb: (doc.data().photoThumb as string | null | undefined) ?? null,
      }))
      .filter(c => c.isArchived !== true)
      .sort((a, b) => a.stageName.localeCompare(b.stageName));

    return NextResponse.json({ creators });
  } catch (error) {
    console.error('[creators GET]', error);
    return NextResponse.json({ error: 'Failed to fetch creators' }, { status: 500 });
  }
});
