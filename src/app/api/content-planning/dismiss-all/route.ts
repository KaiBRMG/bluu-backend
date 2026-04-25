import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { adminDb } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { checkPageAccess } from '@/lib/middleware/apiHelpers';
import type { DecodedIdToken } from 'firebase-admin/auth';

// Batch-archives all completed, non-archived content planning entries.
export const POST = withAuth(async (
  _request: NextRequest,
  token: DecodedIdToken,
) => {
  try {
    const denied = await checkPageAccess(token.uid, 'creators-content-planning');
    if (denied) return denied;

    const snap = await adminDb
      .collection('content-planning')
      .where('status', '==', 'Completed')
      .where('isArchived', '==', false)
      .get();

    if (snap.empty) {
      return NextResponse.json({ success: true, count: 0 });
    }

    // Firestore batch limit is 500 writes
    const CHUNK = 500;
    const docs = snap.docs;
    for (let i = 0; i < docs.length; i += CHUNK) {
      const batch = adminDb.batch();
      for (const doc of docs.slice(i, i + CHUNK)) {
        batch.update(doc.ref, {
          isArchived: true,
          lastEditedAt: FieldValue.serverTimestamp(),
          lastEditedBy: token.uid,
        });
      }
      await batch.commit();
    }

    return NextResponse.json({ success: true, count: docs.length });
  } catch (error) {
    console.error('[POST /api/content-planning/dismiss-all]', error);
    return NextResponse.json({ error: 'Failed to dismiss all' }, { status: 500 });
  }
});
