import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { adminDb } from '@/lib/firebase-admin';
import type { DecodedIdToken } from 'firebase-admin/auth';

export const POST = withAuth(async (request: NextRequest, token: DecodedIdToken) => {
  try {
    const body = await request.json();
    const { notificationId, all } = body as { notificationId?: string; all?: boolean };

    if (all) {
      // Mark all unread notifications for this user as read
      const snap = await adminDb
        .collection('notifications')
        .where('userId', '==', token.uid)
        .where('read', '==', false)
        .get();

      if (!snap.empty) {
        const batch = adminDb.batch();
        snap.docs.forEach((doc) => batch.update(doc.ref, { read: true }));
        await batch.commit();
      }

      return NextResponse.json({ success: true, updated: snap.size });
    }

    if (notificationId) {
      // Mark a single notification as read — verify ownership first
      const ref = adminDb.collection('notifications').doc(notificationId);
      const doc = await ref.get();

      if (!doc.exists) {
        return NextResponse.json({ error: 'Notification not found' }, { status: 404 });
      }

      if (doc.data()?.userId !== token.uid) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }

      await ref.update({ read: true });
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'Provide notificationId or all: true' }, { status: 400 });
  } catch (error: unknown) {
    console.error('[notifications/mark-read]', error);
    return NextResponse.json({ error: 'Failed to update notifications' }, { status: 500 });
  }
});
