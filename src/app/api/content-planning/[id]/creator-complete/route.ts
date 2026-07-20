import { NextRequest, NextResponse } from 'next/server';
import { withCreatorAuth } from '@/lib/middleware/withCreatorAuth';
import { adminDb } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { addNotificationToBatch } from '@/lib/middleware/apiHelpers';
import { notifications } from '@/lib/notificationContent';
import { getOFAMUids } from '@/lib/services/campaignTrackingService';
import type { DecodedIdToken } from 'firebase-admin/auth';

// Creator complete: status=Completed, isArchived stays false — fires notification to OFAM.
// `revert: true` undoes it (status back to Outstanding, completedAt cleared, no notification),
// mirroring the campaign-tracking creator-complete endpoint so the client can offer Undo.
export const POST = withCreatorAuth(async (
  _request: NextRequest,
  token: DecodedIdToken,
  params: Promise<{ id: string }>,
) => {
  try {
    const { id } = await params;
    const docRef = adminDb.collection('content-planning').doc(id);
    const snap = await docRef.get();

    if (!snap.exists) {
      return NextResponse.json({ error: 'Entry not found' }, { status: 404 });
    }

    const data = snap.data()!;
    if (data.creatorID !== token.uid) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const body = await _request.json().catch(() => ({})) as { revert?: boolean };

    // Revert: put the entry back to Outstanding without re-notifying.
    if (body.revert) {
      await docRef.update({
        status: 'Outstanding',
        completedAt: FieldValue.delete(),
        lastEditedAt: FieldValue.serverTimestamp(),
        lastEditedBy: token.uid,
      });
      return NextResponse.json({ success: true, status: 'Outstanding' });
    }

    // Look up creator's stage name for the notification message
    const creatorSnap = await adminDb.collection('creators').doc(token.uid).get();
    const stageName = (creatorSnap.data()?.stageName as string | undefined) ?? token.uid;
    const contentSummary = (data.contentSummary as string | undefined) ?? '';

    const batch = adminDb.batch();
    batch.update(docRef, {
      status: 'Completed',
      completedAt: FieldValue.serverTimestamp(),
      lastEditedAt: FieldValue.serverTimestamp(),
      lastEditedBy: token.uid,
    });

    const ofamUids = await getOFAMUids();
    for (const uid of ofamUids) {
      addNotificationToBatch(batch, uid, notifications.contentPlanCompleted(stageName, contentSummary));
    }

    await batch.commit();
    return NextResponse.json({ success: true, status: 'Completed' });
  } catch (error) {
    console.error('[POST /api/content-planning/:id/creator-complete]', error);
    return NextResponse.json({ error: 'Failed to complete entry' }, { status: 500 });
  }
});
