import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { adminDb } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { checkPageAccess } from '@/lib/middleware/apiHelpers';
import type { DecodedIdToken } from 'firebase-admin/auth';

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
      isArchived: true,
      lastEditedAt: FieldValue.serverTimestamp(),
      lastEditedBy: token.uid,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[POST /api/content-planning/:id/dismiss]', error);
    return NextResponse.json({ error: 'Failed to dismiss entry' }, { status: 500 });
  }
});
