import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { adminDb } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { checkPageAccess } from '@/lib/middleware/apiHelpers';
import type { DecodedIdToken } from 'firebase-admin/auth';

// Manager complete: status=Completed, isArchived=true — no notification.
export const POST = withAuth(async (
  _request: NextRequest,
  token: DecodedIdToken,
  params: Promise<{ id: string }>,
) => {
  try {
    const denied = await checkPageAccess(token.uid, 'creators-content-planning');
    if (denied) return denied;

    const { id } = await params;
    await adminDb.collection('content-planning').doc(id).update({
      status: 'Completed',
      isArchived: true,
      completedAt: FieldValue.serverTimestamp(),
      lastEditedAt: FieldValue.serverTimestamp(),
      lastEditedBy: token.uid,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[POST /api/content-planning/:id/manager-complete]', error);
    return NextResponse.json({ error: 'Failed to complete entry' }, { status: 500 });
  }
});
