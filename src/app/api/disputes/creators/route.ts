import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { adminDb } from '@/lib/firebase-admin';

/**
 * GET /api/disputes/creators
 * Returns all creators sorted alphabetically by stageName.
 */
export const GET = withAuth(async (_request: NextRequest) => {
  try {
    const snap = await adminDb
      .collection('creators')
      .select('creatorID', 'stageName', 'defaultTimezone')
      .get();
    const creators = snap.docs
      .map(doc => ({
        creatorID: doc.data().creatorID as string,
        stageName: doc.data().stageName as string,
        defaultTimezone: (doc.data().defaultTimezone as string | undefined) ?? undefined,
      }))
      .sort((a, b) => a.stageName.localeCompare(b.stageName));

    return NextResponse.json({ creators });
  } catch (error) {
    console.error('[disputes/creators GET]', error);
    return NextResponse.json({ error: 'Failed to fetch creators' }, { status: 500 });
  }
});
