import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { adminDb } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { getUserById } from '@/lib/services/userService';
import { getOFAMUids } from '@/lib/services/campaignTrackingService';
import { addNotificationToBatch } from '@/lib/middleware/apiHelpers';
import { notifications, telegramMessages } from '@/lib/notificationContent';
import { sendTelegramNotification, sendTelegramToCreator, escapeHtml } from '@/lib/services/telegramService';
import { formatAmount, formatDueDate } from '@/lib/campaignTracking';
import type { DecodedIdToken } from 'firebase-admin/auth';
import type { CRStatus } from '@/lib/campaignTracking';

const EDITABLE_FIELDS = [
  'fanName', 'profileLink', 'description', 'length', 'totalAmount', 'amountPaid',
  'address', 'socialUsername', 'socialPlatform', 'callType', 'dueDate', 'dueDateTimezone',
  'status', 'priority', 'managerComment', 'isArchived',
] as const;

export const PATCH = withAuth(async (request: NextRequest, token: DecodedIdToken, params: Promise<{ id: string }>) => {
  try {
    const caller = await getUserById(token.uid);
    const canEdit = caller?.permittedPageIds?.includes('ca-custom-requests') ||
                    caller?.permittedPageIds?.includes('creators-custom-requests') ||
                    caller?.permittedPageIds?.includes('ca-campaigns');
    if (!canEdit) return NextResponse.json({ error: 'Access denied' }, { status: 403 });

    const { id } = await params;
    const body = await request.json();

    const docRef = adminDb.collection('campaign-tracking').doc(id);
    const docSnap = await docRef.get();
    if (!docSnap.exists) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const current = docSnap.data()!;
    const prevStatus = current.status as CRStatus;

    const update: Record<string, unknown> = {
      lastEditedBy: token.uid,
      lastEditedTime: FieldValue.serverTimestamp(),
    };

    for (const field of EDITABLE_FIELDS) {
      if (field in body) {
        if (field === 'totalAmount' || field === 'amountPaid') {
          update[field] = Number(body[field]);
        } else if (field === 'dueDate') {
          update[field] = body[field] || null; // stored as plain "YYYY-MM-DD" string
        } else {
          update[field] = body[field];
        }
      }
    }

    await docRef.update(update);

    const newStatus = (body.status ?? prevStatus) as CRStatus;

    // Notify on status changes
    if (newStatus !== prevStatus) {
      const creatorSnap = await adminDb.collection('creators').doc(current.creatorID).get();
      const stageName = creatorSnap.data()?.stageName ?? current.creatorID;
      const editorName = caller?.displayName ?? token.uid;

      if (newStatus === 'Rejected') {
        const content = notifications.crRejected(editorName, current.CR, stageName);
        const notifBatch = adminDb.batch();
        addNotificationToBatch(notifBatch, current.createdBy, content);
        await notifBatch.commit();
        await sendTelegramNotification([current.createdBy], content);
      }

      if (newStatus === 'Completed') {
        const ofamUids = await getOFAMUids();
        if (ofamUids.length > 0) {
          const content = notifications.crCompleted(current.CR, stageName);
          const notifBatch = adminDb.batch();
          for (const uid of ofamUids) {
            addNotificationToBatch(notifBatch, uid, content);
          }
          await notifBatch.commit();
          await sendTelegramNotification(ofamUids, content);
        }
      }

      // A CR/Item/Call entry approved (Awaiting Approval → In Progress) — tell
      // the creator. Telegram only: creators have no in-app tray. Guarded to
      // the genuine approval transition so re-approving after an unarchive
      // (also a move into 'In Progress', see creator-portal/custom-requests)
      // does not look like a brand-new request to the creator.
      if (
        newStatus === 'In Progress' &&
        prevStatus === 'Awaiting Approval' &&
        (current.type === 'CR' || current.type === 'Item' || current.type === 'Call')
      ) {
        const fanName = escapeHtml(current.fanName ?? 'A fan');
        const totalAmount = formatAmount(Number(current.totalAmount) || 0);
        const html =
          current.type === 'CR'
            ? telegramMessages.creatorNewCustomRequest(fanName, totalAmount)
            : current.type === 'Item'
              ? telegramMessages.creatorNewItemRequest(fanName, totalAmount)
              : telegramMessages.creatorNewScheduledCall(
                  escapeHtml(current.callType ?? 'call'),
                  fanName,
                  formatDueDate(current.dueDate),
                  totalAmount,
                );
        await sendTelegramToCreator(current.creatorID, html);
      }
    }

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error('[PATCH /api/campaign-tracking/[id]]', error);
    return NextResponse.json({ error: 'Failed to update entry' }, { status: 500 });
  }
});

export const DELETE = withAuth(async (_request: NextRequest, token: DecodedIdToken, params: Promise<{ id: string }>) => {
  try {
    const caller = await getUserById(token.uid);
    if (!caller?.permittedPageIds?.includes('creators-custom-requests')) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const { id } = await params;
    await adminDb.collection('campaign-tracking').doc(id).delete();

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error('[DELETE /api/campaign-tracking/[id]]', error);
    return NextResponse.json({ error: 'Failed to delete entry' }, { status: 500 });
  }
});
