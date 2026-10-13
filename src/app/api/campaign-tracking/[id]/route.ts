import { NextRequest, NextResponse, after } from 'next/server';
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
import { CAMPAIGN_TYPES } from '@/lib/campaignTracking';
import { cleanFanName } from '@/lib/fans/fanIdentity';
import { refreshFanCustomsQuietly, resolveFanKeyForLink } from '@/lib/services/fanRegistryService';

const EDITABLE_FIELDS = [
  'fanName', 'profileLink', 'description', 'length', 'totalAmount', 'amountPaid',
  'address', 'socialUsername', 'socialPlatform', 'callType', 'dueDate', 'dueDateTimezone',
  'status', 'priority', 'managerComment', 'isArchived',
] as const;

/** Fields whose change moves the fan's name or customs rollup. */
const FAN_FIELDS = ['fanName', 'profileLink', 'totalAmount', 'amountPaid', 'status', 'isArchived'] as const;

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

    if ('fanName' in update) {
      update.fanName = cleanFanName(String(update.fanName ?? ''));
      if (!update.fanName) return NextResponse.json({ error: 'A fan name is required.' }, { status: 400 });
    }

    // The fan this custom belongs to follows its profile link.
    const prevFanKey = (current.fanKey as string | null | undefined) ?? null;
    let nextFanKey = prevFanKey;
    if ('profileLink' in update && update.profileLink !== current.profileLink) {
      nextFanKey = await resolveFanKeyForLink(String(update.profileLink ?? ''));
      update.fanKey = nextFanKey;
    }

    // Archiving rewrites the money (a custom's total drops to what was paid; a
    // campaign's paid rises to the total), so keep the figure it replaced —
    // that is how the fan report can say what was abandoned.
    const isCampaign = (CAMPAIGN_TYPES as readonly string[]).includes(String(current.type));
    if (!isCampaign && update.status === 'Archived' && current.status !== 'Archived' && current.originalTotalAmount === undefined) {
      update.originalTotalAmount = Number(current.totalAmount) || 0;
    }
    if (!isCampaign && 'status' in update && update.status !== 'Archived' && current.status === 'Archived') {
      update.originalTotalAmount = FieldValue.delete();
    }
    if (isCampaign && update.isArchived === true && current.isArchived !== true && current.originalAmountPaid === undefined) {
      update.originalAmountPaid = Number(current.amountPaid) || 0;
    }
    if (isCampaign && update.isArchived === false && current.isArchived === true) {
      update.originalAmountPaid = FieldValue.delete();
    }

    await docRef.update(update);

    // Only a real change re-reads the fan's customs; an edit that resends the
    // same values costs nothing. After the response — it never fails the edit.
    if (FAN_FIELDS.some(f => f in update && update[f] !== current[f])) {
      after(() => refreshFanCustomsQuietly([prevFanKey, nextFanKey], 'campaign-tracking/[id] PATCH'));
    }

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
    const ref = adminDb.collection('campaign-tracking').doc(id);
    const fanKey = (await ref.get()).get('fanKey') as string | null | undefined;
    await ref.delete();
    if (fanKey) after(() => refreshFanCustomsQuietly([fanKey], 'campaign-tracking/[id] DELETE'));

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error('[DELETE /api/campaign-tracking/[id]]', error);
    return NextResponse.json({ error: 'Failed to delete entry' }, { status: 500 });
  }
});
