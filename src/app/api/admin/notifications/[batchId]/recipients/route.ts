import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { adminDb } from '@/lib/firebase-admin';
import { getUserById } from '@/lib/services/userService';
import type { DecodedIdToken } from 'firebase-admin/auth';

/**
 * GET /api/admin/notifications/[batchId]/recipients
 * Returns the read/dismissedByUser status for each notification in a batch.
 */
export const GET = withAuth(
  async (_request: NextRequest, token: DecodedIdToken, params: { batchId: string }) => {
    try {
      const caller = await getUserById(token.uid);
      if (!caller?.permittedPageIds?.includes('notifications')) {
        return NextResponse.json({ error: 'Access denied' }, { status: 403 });
      }

      const { batchId } = await params;
      if (!batchId) {
        return NextResponse.json({ error: 'Missing batchId' }, { status: 400 });
      }

      const snap = await adminDb
        .collection('notifications')
        .where('batchId', '==', batchId)
        .get();

      if (snap.empty) {
        return NextResponse.json({ recipients: [] });
      }

      // Fetch display names for all recipients in parallel
      const userIds = snap.docs.map(doc => doc.data().userId as string);
      const uniqueUserIds = [...new Set(userIds)];
      const userDocs = await Promise.all(
        uniqueUserIds.map(uid => adminDb.collection('users').doc(uid).get())
      );
      const displayNameMap: Record<string, string> = {};
      for (const userDoc of userDocs) {
        if (userDoc.exists) {
          displayNameMap[userDoc.id] = userDoc.data()?.displayName ?? userDoc.id;
        }
      }

      const recipients = snap.docs.map(doc => {
        const data = doc.data();
        return {
          userId: data.userId,
          displayName: displayNameMap[data.userId] ?? data.userId,
          read: data.read ?? false,
          dismissedByUser: data.dismissedByUser ?? false,
        };
      });

      return NextResponse.json({ recipients });
    } catch (error: unknown) {
      console.error('[admin/notifications/[batchId]/recipients GET] error:', error);
      return NextResponse.json({ error: 'Failed to fetch recipients' }, { status: 500 });
    }
  }
);
