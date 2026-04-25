import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { adminDb } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { checkPageAccess } from '@/lib/middleware/apiHelpers';
import type { DecodedIdToken } from 'firebase-admin/auth';

export const PATCH = withAuth(async (
  request: NextRequest,
  token: DecodedIdToken,
  params: Promise<{ id: string }>,
) => {
  try {
    const denied = await checkPageAccess(token.uid, 'content-planning');
    if (denied) return denied;

    const { id } = await params;
    const body = await request.json() as Record<string, unknown>;

    const allowed = ['contentType', 'contentSummary', 'description', 'comment', 'dueDate', 'status', 'isArchived', 'completedAt'];
    const updates: Record<string, unknown> = { lastEditedAt: FieldValue.serverTimestamp(), lastEditedBy: token.uid };
    for (const key of allowed) {
      if (key in body) updates[key] = body[key];
    }

    await adminDb.collection('content-planning').doc(id).update(updates);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[PATCH /api/content-planning/:id]', error);
    return NextResponse.json({ error: 'Failed to update entry' }, { status: 500 });
  }
});

export const DELETE = withAuth(async (
  _request: NextRequest,
  token: DecodedIdToken,
  params: Promise<{ id: string }>,
) => {
  try {
    const denied = await checkPageAccess(token.uid, 'content-planning');
    if (denied) return denied;

    const { id } = await params;
    await adminDb.collection('content-planning').doc(id).delete();
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[DELETE /api/content-planning/:id]', error);
    return NextResponse.json({ error: 'Failed to delete entry' }, { status: 500 });
  }
});
