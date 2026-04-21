import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { adminDb } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { getUserById } from '@/lib/services/userService';
import type { DecodedIdToken } from 'firebase-admin/auth';
import type { CRStatus } from '@/lib/campaignTracking';

const EDITABLE_FIELDS = [
  'fanName', 'profileLink', 'description', 'length', 'totalAmount', 'amountPaid',
  'address', 'socialUsername', 'socialPlatform', 'callType', 'dueDate', 'dueDateTimezone',
  'status', 'priority', 'managerComment', 'isArchived',
] as const;

async function getOFAMUids(): Promise<string[]> {
  const snap = await adminDb.collection('groups').doc('OFAM').get();
  return (snap.data()?.members as string[]) ?? [];
}

/**
 * PATCH /api/campaign-tracking/[id]
 * Updates an entry. Handles status-change notifications.
 */
export const PATCH = withAuth(async (request: NextRequest, token: DecodedIdToken, params: Promise<{ id: string }>) => {
  try {
    const caller = await getUserById(token.uid);
    const canEdit = caller?.permittedPageIds?.includes('ca-custom-requests') ||
                    caller?.permittedPageIds?.includes('creator-custom-requests');
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
        const notifBatch = adminDb.batch();
        notifBatch.set(adminDb.collection('notifications').doc(), {
          userId: current.createdBy,
          title: '❗Custom Request Rejected',
          message: `${editorName} has rejected ${current.CR} on ${stageName}. Please review the details and resubmit ASAP!`,
          type: 'alert',
          read: false,
          dismissedByUser: false,
          createdAt: FieldValue.serverTimestamp(),
          actionUrl: 'ca-portal/custom-requests',
          announcement: false,
          announcementExpiry: null,
        });
        await notifBatch.commit();
      }

      if (newStatus === 'Completed') {
        const ofamUids = await getOFAMUids();
        if (ofamUids.length > 0) {
          const notifBatch = adminDb.batch();
          for (const uid of ofamUids) {
            notifBatch.set(adminDb.collection('notifications').doc(), {
              userId: uid,
              title: '✅ Custom Request Completed',
              message: `${current.CR} has been completed on ${stageName}. Please review and send to the fan ASAP!`,
              type: 'success',
              read: false,
              dismissedByUser: false,
              createdAt: FieldValue.serverTimestamp(),
              actionUrl: 'creators/custom-requests',
              announcement: false,
              announcementExpiry: null,
            });
          }
          await notifBatch.commit();
        }
      }
    }

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error('[PATCH /api/campaign-tracking/[id]]', error);
    return NextResponse.json({ error: 'Failed to update entry' }, { status: 500 });
  }
});

/**
 * DELETE /api/campaign-tracking/[id]
 * Permanently deletes an entry. Requires manager permission.
 */
export const DELETE = withAuth(async (_request: NextRequest, token: DecodedIdToken, params: Promise<{ id: string }>) => {
  try {
    const caller = await getUserById(token.uid);
    if (!caller?.permittedPageIds?.includes('creator-custom-requests')) {
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
