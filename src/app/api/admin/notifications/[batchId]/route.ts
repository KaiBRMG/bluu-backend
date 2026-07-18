import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { adminDb } from '@/lib/firebase-admin';
import { checkPageAccess } from '@/lib/middleware/apiHelpers';
import type { DecodedIdToken } from 'firebase-admin/auth';

/**
 * DELETE /api/admin/notifications/[batchId]
 * "Unsends" an admin notification batch: removes every per-user notification
 * doc created for the batch, plus the batch record itself. This retracts the
 * notification from every recipient's tray.
 */
export const DELETE = withAuth(
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

      // Delete the per-user notification docs + the batch doc. A Firestore
      // write batch is capped at 500 ops, so chunk to stay under the limit.
      const refs = snap.docs.map(doc => doc.ref);
      refs.push(adminDb.collection('admin_notification_batches').doc(batchId));

      const CHUNK = 500;
      for (let i = 0; i < refs.length; i += CHUNK) {
        const writeBatch = adminDb.batch();
        for (const ref of refs.slice(i, i + CHUNK)) {
          writeBatch.delete(ref);
        }
        await writeBatch.commit();
      }

      return NextResponse.json({ success: true });
    } catch (error: unknown) {
      console.error('[admin/notifications/[batchId] DELETE] error:', error);
      return NextResponse.json({ error: 'Failed to unsend notification' }, { status: 500 });
    }
  }
);
