import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { adminDb } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { checkPageAccess } from '@/lib/middleware/apiHelpers';
import type { DecodedIdToken } from 'firebase-admin/auth';

export const POST = withAuth(async (request: NextRequest, token: DecodedIdToken) => {
  try {
    const denied = await checkPageAccess(token.uid, 'content-planning');
    if (denied) return denied;

    const body = await request.json() as {
      contentType: 'SFW' | 'NSFW';
      contentSummary: string;
      description: Array<{ qty: string; content: string }>;
      comment?: string;
      dueDate?: string | null;
      creatorID: string;
    };

    const { contentType, contentSummary, description, comment, dueDate, creatorID } = body;

    if (!contentType || !contentSummary || !creatorID) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const creatorSnap = await adminDb.collection('creators').doc(creatorID).get();
    if (!creatorSnap.exists) {
      return NextResponse.json({ error: 'Creator not found' }, { status: 404 });
    }

    const ref = adminDb.collection('content-planning').doc();
    await ref.set({
      contentType,
      contentSummary,
      description: description ?? [],
      comment: comment ?? '',
      dueDate: dueDate ?? null,
      createdAt: FieldValue.serverTimestamp(),
      completedAt: null,
      lastEditedAt: null,
      lastEditedBy: null,
      status: 'Outstanding',
      creatorID,
      isArchived: false,
    });

    return NextResponse.json({ success: true, id: ref.id });
  } catch (error) {
    console.error('[POST /api/content-planning]', error);
    return NextResponse.json({ error: 'Failed to create entry' }, { status: 500 });
  }
});
