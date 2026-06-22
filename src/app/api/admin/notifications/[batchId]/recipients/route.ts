import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { adminDb } from '@/lib/firebase-admin';
import { checkPageAccess } from '@/lib/middleware/apiHelpers';
import type { DecodedIdToken } from 'firebase-admin/auth';

/**
 * GET /api/admin/notifications/[batchId]/recipients
 * Returns the read/dismissedByUser status for each notification in a batch.
 */
export const GET = withAuth(
  async (_request: NextRequest, token: DecodedIdToken, params: Promise<{ batchId: string }>) => {
    try {
      const denied = await checkPageAccess(token.uid, 'admin-notifications');
      if (denied) return denied;

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

      // Batch-fetch display names for all recipients in a single round-trip
      const userIds = snap.docs.map(doc => doc.data().userId as string);
      const uniqueUserIds = [...new Set(userIds)];
      const displayNameMap: Record<string, string> = {};
      if (uniqueUserIds.length > 0) {
        const refs = uniqueUserIds.map(uid => adminDb.collection('users').doc(uid));
        const userDocs = await adminDb.getAll(...refs);
        for (const userDoc of userDocs) {
          if (userDoc.exists) {
            displayNameMap[userDoc.id] = userDoc.data()?.displayName ?? userDoc.id;
          }
        }
      }

      const recipients = snap.docs.map(doc => {
        const data = doc.data();
        return {
          userId: data.userId,
          // Empty displayName signals a deleted user → rendered as italic "Deleted User"
          displayName: displayNameMap[data.userId] ?? '',
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
