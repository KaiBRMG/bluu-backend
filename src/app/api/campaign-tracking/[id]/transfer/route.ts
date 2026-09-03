import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { adminDb } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { getUserById } from '@/lib/services/userService';
import { addNotificationToBatch } from '@/lib/middleware/apiHelpers';
import { notifications } from '@/lib/notificationContent';
import { sendTelegramNotification } from '@/lib/services/telegramService';
import { CAMPAIGN_TYPES } from '@/lib/campaignTracking';
import type { DecodedIdToken } from 'firebase-admin/auth';

type UserLike = { displayName?: string; firstName?: string; lastName?: string } | null | undefined;

const displayNameOf = (u: UserLike, fallback: string) =>
  u?.displayName || `${u?.firstName ?? ''} ${u?.lastName ?? ''}`.trim() || fallback;

/** Cached read (`getUserById` has a 60s cache) — no extra uncached I/O. */
const resolveName = async (uid: string) => displayNameOf(await getUserById(uid), uid);

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
    const isCampaign = (CAMPAIGN_TYPES as readonly string[]).includes(current.type);
    const actionUrl = isCampaign ? '/ca-portal/campaigns' : '/ca-portal/custom-requests';

    // Which copy is sent is derived from the stored doc, never from the client:
    // a transfer performed by someone other than the owner (a manager on
    // /creator-portal/custom-requests) names the *previous owner*, because the
    // recipient is inheriting that person's work — not the mover's.
    const previousOwnerUid: string | undefined = current.createdBy;
    const transferredOnBehalf = !!previousOwnerUid && previousOwnerUid !== token.uid;
    const content = transferredOnBehalf
      ? notifications.crTransferredOnBehalf(await resolveName(previousOwnerUid), stageName, actionUrl)
      : notifications.crTransferred(displayNameOf(caller, token.uid), stageName, actionUrl);

    const batch = adminDb.batch();
    addNotificationToBatch(batch, toUid, content);
    await batch.commit();
    await sendTelegramNotification([toUid], content);

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error('[POST /api/campaign-tracking/[id]/transfer]', error);
    return NextResponse.json({ error: 'Failed to transfer entry' }, { status: 500 });
  }
});
