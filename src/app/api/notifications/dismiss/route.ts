import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { adminDb } from '@/lib/firebase-admin';
import type { DecodedIdToken } from 'firebase-admin/auth';

/**
 * Dismiss notifications for the authenticated user. Sets dismissedByUser: true.
 *
 * Body options:
 *   {}                       — dismiss all read notifications (tray trash action)
 *   { notificationId: string } — dismiss a single notification by ID (e.g. expired announcement)
 */
export const POST = withAuth(async (request: NextRequest, token: DecodedIdToken) => {
  try {
    const body = await request.json().catch(() => ({}));
    const { notificationId } = body as { notificationId?: string };

    if (notificationId) {
      const ref = adminDb.collection('notifications').doc(notificationId);
      const doc = await ref.get();

      if (!doc.exists) {
        return NextResponse.json({ error: 'Notification not found' }, { status: 404 });
      }
      if (doc.data()?.userId !== token.uid) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }

      await ref.update({ dismissedByUser: true });
      return NextResponse.json({ success: true, dismissed: 1 });
    }

    // Dismiss all read non-announcement notifications (tray trash action)
    const snap = await adminDb
      .collection('notifications')
      .where('userId', '==', token.uid)
      .where('read', '==', true)
      .where('dismissedByUser', '==', false)
      .get();

    const toDismiss = snap.docs.filter((doc) => !doc.data().announcement);

    if (toDismiss.length > 0) {
      const batch = adminDb.batch();
      toDismiss.forEach((doc) => batch.update(doc.ref, { dismissedByUser: true }));
      await batch.commit();
    }

    return NextResponse.json({ success: true, dismissed: toDismiss.length });
  } catch (error: unknown) {
    console.error('[notifications/dismiss]', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    );
  }
});
