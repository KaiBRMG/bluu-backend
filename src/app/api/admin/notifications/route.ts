import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { adminDb } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { getUserById } from '@/lib/services/userService';
import { sendTelegramNotification, sendTelegramNotificationToCreators } from '@/lib/services/telegramService';
import { normalizeActionUrl } from '@/lib/notificationActionUrl';
import type { DecodedIdToken } from 'firebase-admin/auth';
import type { NotificationType } from '@/types/firestore';

const ADMIN_NOTIF_TYPES: NotificationType[] = ['shift', 'alert', 'success', 'action'];

/**
 * GET /api/admin/notifications
 * Returns the 50 most recent admin notification batches.
 */
export const GET = withAuth(async (_request: NextRequest, token: DecodedIdToken) => {
  try {
    const caller = await getUserById(token.uid);
    if (!caller?.permittedPageIds?.includes('admin-notifications')) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const snap = await adminDb
      .collection('admin_notification_batches')
      .orderBy('sentAt', 'desc')
      .limit(50)
      .get();

    const batches = snap.docs.map(doc => {
      const data = doc.data();
      return {
        ...data,
        id: doc.id,
        sentAt: data.sentAt?.toDate?.()?.toISOString() ?? null,
      };
    });

    return NextResponse.json({ batches });
  } catch (error: unknown) {
    console.error('[admin/notifications GET] error:', error);
    return NextResponse.json({ error: 'Failed to fetch notification batches' }, { status: 500 });
  }
});

/**
 * POST /api/admin/notifications
 * Creates a notification batch and individual notification docs for each
 * employee recipient. `creatorIds`/`allCreators` name creator recipients
 * separately — they get no `notifications` doc (no in-app tray) and are
 * always delivered over Telegram instead, regardless of `sendTelegram`.
 * Body: { title, message, type, userIds, groupIds, creatorIds, allCreators, sendTelegram }
 */
export const POST = withAuth(async (request: NextRequest, token: DecodedIdToken) => {
  try {
    const caller = await getUserById(token.uid);
    if (!caller?.permittedPageIds?.includes('admin-notifications')) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const body = await request.json();
    const {
      title,
      message,
      type,
      userIds = [],
      groupIds = [],
      creatorIds = [],
      allCreators = false,
      actionUrl = null,
      sendTelegram = false,
    } = body as {
      title: string;
      message: string;
      type: NotificationType;
      userIds: string[];
      groupIds: string[];
      creatorIds?: string[];
      allCreators?: boolean;
      actionUrl?: string | null;
      sendTelegram?: boolean;
    };

    if (!title?.trim() || !message?.trim()) {
      return NextResponse.json({ error: 'Title and message are required' }, { status: 400 });
    }
    if (!ADMIN_NOTIF_TYPES.includes(type)) {
      return NextResponse.json({ error: 'Invalid notification type' }, { status: 400 });
    }
    if (!Array.isArray(userIds) || !Array.isArray(groupIds) || !Array.isArray(creatorIds)) {
      return NextResponse.json({ error: 'userIds, groupIds and creatorIds must be arrays' }, { status: 400 });
    }

    // Store the canonical form, so no surface has to guess later whether a
    // stored value is an app route or a host. An admin typing `example.com`
    // gets `https://example.com`; an unsafe scheme is dropped to null rather
    // than persisted for a client to act on.
    const resolvedActionUrl = normalizeActionUrl(actionUrl);

    // Expand group members server-side
    const allRecipientUids = new Set<string>(userIds);

    if (groupIds.length > 0) {
      const groupRefs = groupIds.map(id => adminDb.collection('groups').doc(id));
      const groupDocs = await adminDb.getAll(...groupRefs);
      for (const doc of groupDocs) {
        if (doc.exists) {
          const members: string[] = doc.data()?.members ?? [];
          members.forEach(uid => allRecipientUids.add(uid));
        }
      }
    }

    // Creators are a separate identity space with no in-app tray (telegram.md)
    // — they never join `allRecipientUids`, which drives the `notifications`
    // collection writes below. "All Creators" expands server-side, the same
    // way an employee group does, filtering out archived creators (rule 6).
    const allCreatorUids = new Set<string>(creatorIds);
    if (allCreators === true) {
      const creatorsSnap = await adminDb.collection('creators').get();
      for (const doc of creatorsSnap.docs) {
        if (doc.data().isArchived !== true) allCreatorUids.add(doc.id);
      }
    }

    if (allRecipientUids.size === 0 && allCreatorUids.size === 0) {
      return NextResponse.json({ error: 'No recipients selected' }, { status: 400 });
    }

    // Firestore batch is limited to 500 writes. One write for the batch doc + N for notifications.
    // In practice recipient counts should be well under 499 for this app.
    const batchRef = adminDb.collection('admin_notification_batches').doc();
    const batchId = batchRef.id;

    const writeBatch = adminDb.batch();

    writeBatch.set(batchRef, {
      title,
      message,
      type,
      sentBy: token.uid,
      sentByName: caller.displayName ?? token.email ?? token.uid,
      sentAt: FieldValue.serverTimestamp(),
      recipientUserIds: userIds,
      recipientGroupIds: groupIds,
      recipientCreatorIds: creatorIds,
      recipientAllCreators: allCreators === true,
      recipientCount: allRecipientUids.size + allCreatorUids.size,
      // Telegram genuinely gets used whenever a creator is a recipient, even
      // if the admin never checked the box — it's their only channel.
      sentViaTelegram: sendTelegram === true || allCreatorUids.size > 0,
      batchId,
    });

    for (const uid of allRecipientUids) {
      writeBatch.set(adminDb.collection('notifications').doc(), {
        userId: uid,
        title,
        message,
        type,
        read: false,
        dismissedByUser: false,
        createdAt: FieldValue.serverTimestamp(),
        actionUrl: resolvedActionUrl,
        announcement: false,
        announcementExpiry: null,
        batchId,
      });
    }

    await writeBatch.commit();

    // Telegram is a secondary channel for employees (the in-app notification
    // above is already committed, so a failure here is reported, never
    // thrown) but the *only* channel for creators — their send is
    // unconditional, not gated on `sendTelegram`. Both results are merged so
    // the client shows one outcome regardless of which recipients were mixed in.
    const telegramParts: { sent: number; failed: number; skipped: boolean; error?: string }[] = [];
    if (sendTelegram === true && allRecipientUids.size > 0) {
      telegramParts.push(
        await sendTelegramNotification([...allRecipientUids], {
          title,
          message,
          actionUrl: resolvedActionUrl,
        }),
      );
    }
    if (allCreatorUids.size > 0) {
      telegramParts.push(
        await sendTelegramNotificationToCreators([...allCreatorUids], {
          title,
          message,
          actionUrl: resolvedActionUrl,
        }),
      );
    }

    let telegram: { sent: number; failed: number; skipped: boolean; error?: string } | null = null;
    if (telegramParts.length > 0) {
      telegram = telegramParts.reduce((acc, part) => ({
        sent: acc.sent + part.sent,
        failed: acc.failed + part.failed,
        skipped: acc.skipped || part.skipped,
        error: acc.error ?? part.error,
      }));
      if (telegram.failed > 0 || telegram.skipped) {
        console.error('[admin/notifications POST] telegram delivery issue:', telegram);
      }
    }

    return NextResponse.json({ success: true, batchId, telegram });
  } catch (error: unknown) {
    console.error('[admin/notifications POST] error:', error);
    return NextResponse.json({ error: 'Failed to send notification' }, { status: 500 });
  }
});
