import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { adminDb } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { getUserById } from '@/lib/services/userService';
import { addNotificationToBatch } from '@/lib/middleware/apiHelpers';
import { notifications } from '@/lib/notificationContent';
import { CAMPAIGN_TYPES } from '@/lib/campaignTracking';
import type { DecodedIdToken } from 'firebase-admin/auth';

export const POST = withAuth(async (request: NextRequest, token: DecodedIdToken, params: Promise<{ id: string }>) => {
  try {
    const caller = await getUserById(token.uid);
    const canEdit = caller?.permittedPageIds?.includes('ca-custom-requests') ||
                    caller?.permittedPageIds?.includes('ca-campaigns') ||
                    caller?.permittedPageIds?.includes('creators-custom-requests');
    if (!canEdit) return NextResponse.json({ error: 'Access denied' }, { status: 403 });

    const { id } = await params;
    const { toUid } = await request.json();
    if (!toUid || typeof toUid !== 'string') {
      return NextResponse.json({ error: 'Missing target user' }, { status: 400 });
    }

    // Only allow transferring to an active CA-group member.
    const target = await getUserById(toUid);
    if (!target || target.isArchived || !target.groups?.includes('CA')) {
      return NextResponse.json({ error: 'Invalid transfer target' }, { status: 400 });
    }

    const docRef = adminDb.collection('campaign-tracking').doc(id);
    const docSnap = await docRef.get();
    if (!docSnap.exists) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const current = docSnap.data()!;

    await docRef.update({
      createdBy: toUid,
      lastEditedBy: token.uid,
      lastEditedTime: FieldValue.serverTimestamp(),
    });

    // Notify the recipient.
    const creatorSnap = await adminDb.collection('creators').doc(current.creatorID).get();
    const stageName = creatorSnap.data()?.stageName ?? current.creatorID;
    const transferrerName =
      caller?.displayName || `${caller?.firstName ?? ''} ${caller?.lastName ?? ''}`.trim() || token.uid;
    const isCampaign = (CAMPAIGN_TYPES as readonly string[]).includes(current.type);
    const actionUrl = isCampaign ? '/ca-portal/campaigns' : '/ca-portal/custom-requests';

    const batch = adminDb.batch();
    addNotificationToBatch(batch, toUid, notifications.crTransferred(transferrerName, stageName, actionUrl));
    await batch.commit();

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error('[POST /api/campaign-tracking/[id]/transfer]', error);
    return NextResponse.json({ error: 'Failed to transfer entry' }, { status: 500 });
  }
});
