import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { adminDb } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { getUserById } from '@/lib/services/userService';
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
 * Creates a notification batch and individual notification docs for each recipient.
 * Body: { title, message, type, userIds: string[], groupIds: string[] }
 */
export const POST = withAuth(async (request: NextRequest, token: DecodedIdToken) => {
  try {
    const caller = await getUserById(token.uid);
    if (!caller?.permittedPageIds?.includes('admin-notifications')) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const body = await request.json();
    const { title, message, type, userIds = [], groupIds = [] } = body as {
      title: string;
      message: string;
      type: NotificationType;
      userIds: string[];
      groupIds: string[];
    };

    if (!title?.trim() || !message?.trim()) {
      return NextResponse.json({ error: 'Title and message are required' }, { status: 400 });
    }
    if (!ADMIN_NOTIF_TYPES.includes(type)) {
      return NextResponse.json({ error: 'Invalid notification type' }, { status: 400 });
    }
    if (!Array.isArray(userIds) || !Array.isArray(groupIds)) {
      return NextResponse.json({ error: 'userIds and groupIds must be arrays' }, { status: 400 });
    }

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

    if (allRecipientUids.size === 0) {
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
      recipientCount: allRecipientUids.size,
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
        actionUrl: null,
        announcement: false,
        announcementExpiry: null,
        batchId,
      });
    }

    await writeBatch.commit();

    return NextResponse.json({ success: true, batchId });
  } catch (error: unknown) {
    console.error('[admin/notifications POST] error:', error);
    return NextResponse.json({ error: 'Failed to send notification' }, { status: 500 });
  }
});
