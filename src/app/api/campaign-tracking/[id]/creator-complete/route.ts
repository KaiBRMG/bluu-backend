import { NextRequest, NextResponse } from 'next/server';
import { withCreatorAuth } from '@/lib/middleware/withCreatorAuth';
import { adminDb } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { getOFAMUids } from '@/lib/services/campaignTrackingService';
import { addNotificationToBatch } from '@/lib/middleware/apiHelpers';
import { notifications } from '@/lib/notificationContent';
import type { DecodedIdToken } from 'firebase-admin/auth';

export const POST = withCreatorAuth(async (_request: NextRequest, token: DecodedIdToken, params: Promise<{ id: string }>) => {
  try {
    const { id } = await params;

    const docRef = adminDb.collection('campaign-tracking').doc(id);
    const docSnap = await docRef.get();
    if (!docSnap.exists) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const data = docSnap.data()!;
    if (data.creatorID !== token.uid) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const body = await _request.json().catch(() => ({})) as { revert?: boolean };
    const newStatus = body.revert ? 'Awaiting Approval' : 'Completed';

    await docRef.update({
      status: newStatus,
      lastEditedBy: token.uid,
      lastEditedTime: FieldValue.serverTimestamp(),
    });

    if (newStatus === 'Completed') {
      const [ofamUids, creatorSnap] = await Promise.all([
        getOFAMUids(),
        adminDb.collection('creators').doc(data.creatorID).get(),
      ]);
      if (ofamUids.length > 0) {
        const stageName = creatorSnap.data()?.stageName ?? data.creatorID;
        const notifBatch = adminDb.batch();
        for (const uid of ofamUids) {
          addNotificationToBatch(notifBatch, uid, notifications.crCompleted(data.CR, stageName));
        }
        await notifBatch.commit();
      }
    }

    return NextResponse.json({ success: true, status: newStatus });
  } catch (error: unknown) {
    console.error('[POST /api/campaign-tracking/[id]/creator-complete]', error);
    return NextResponse.json({ error: 'Failed to update status' }, { status: 500 });
  }
});
