import { NextRequest, NextResponse } from 'next/server';
import { withCreatorAuth } from '@/lib/middleware/withCreatorAuth';
import { adminDb } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import type { DecodedIdToken } from 'firebase-admin/auth';

async function getOFAMUids(): Promise<string[]> {
  const snap = await adminDb.collection('groups').doc('OFAM').get();
  return (snap.data()?.members as string[]) ?? [];
}

/**
 * POST /api/campaign-tracking/[id]/creator-complete
 * Creator marks an entry as Completed (or reverts to Awaiting Approval).
 * Only the creator whose creatorID matches may call this.
 */
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
      const ofamUids = await getOFAMUids();
      if (ofamUids.length > 0) {
        const creatorSnap = await adminDb.collection('creators').doc(data.creatorID).get();
        const stageName = creatorSnap.data()?.stageName ?? data.creatorID;
        const notifBatch = adminDb.batch();
        for (const uid of ofamUids) {
          notifBatch.set(adminDb.collection('notifications').doc(), {
            userId: uid,
            title: '✅ Custom Request Completed',
            message: `${data.CR} has been completed on ${stageName}. Please review and send to the fan ASAP!`,
            type: 'success',
            read: false,
            dismissedByUser: false,
            createdAt: FieldValue.serverTimestamp(),
            actionUrl: '/creators/custom-requests',
            announcement: false,
            announcementExpiry: null,
          });
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
