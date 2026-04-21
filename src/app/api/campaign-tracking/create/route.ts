import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { adminDb } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { getUserById } from '@/lib/services/userService';
import { getOFAMUids } from '@/lib/services/campaignTrackingService';
import type { DecodedIdToken } from 'firebase-admin/auth';
import type { CRType, CallType } from '@/lib/campaignTracking';
import { formatCR } from '@/lib/campaignTracking';

export const POST = withAuth(async (request: NextRequest, token: DecodedIdToken) => {
  try {
    const caller = await getUserById(token.uid);
    if (!caller?.permittedPageIds?.includes('ca-custom-requests')) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const body = await request.json();
    const {
      creatorID,
      type,
      fanName,
      profileLink,
      description,
      length,
      totalAmount,
      amountPaid,
      address,
      socialUsername,
      socialPlatform,
      callType,
      dueDate,
      dueDateTimezone,
    } = body as {
      creatorID: string;
      type: CRType;
      fanName: string;
      profileLink: string;
      description: string;
      length?: string;
      totalAmount: number;
      amountPaid: number;
      address?: string;
      socialUsername?: string;
      socialPlatform?: string;
      callType?: CallType;
      dueDate?: string | null;
      dueDateTimezone?: string | null;
    };

    if (!creatorID || !type || !fanName || !description) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const creatorRef = adminDb.collection('creators').doc(creatorID);
    const entryRef = adminDb.collection('campaign-tracking').doc();

    const result = await adminDb.runTransaction(async (tx) => {
      const creatorSnap = await tx.get(creatorRef);
      if (!creatorSnap.exists) throw new Error('Creator not found');

      const creatorData = creatorSnap.data()!;
      const nextNum = (creatorData.lastCRID ?? 0) + 1;
      const cr = formatCR(nextNum);
      const stageName = (creatorData.stageName as string | undefined) ?? creatorID;

      const entryData: Record<string, unknown> = {
        CR: cr,
        creatorID,
        type,
        status: 'Awaiting Approval',
        priority: null,
        fanName,
        profileLink,
        description,
        totalAmount: Number(totalAmount),
        amountPaid: Number(amountPaid ?? 0),
        managerComment: '',
        isArchived: false,
        createdBy: token.uid,
        lastEditedBy: token.uid,
        createdTime: FieldValue.serverTimestamp(),
        lastEditedTime: FieldValue.serverTimestamp(),
      };

      // dueDate stored as plain "YYYY-MM-DD" string (no Timestamp conversion)
      entryData.dueDate = dueDate || null;
      entryData.dueDateTimezone = dueDateTimezone || null;

      if (type === 'CR') {
        entryData.length = length ?? '';
      } else if (type === 'Call') {
        entryData.length = length ?? '';
        entryData.callType = callType ?? '';
        entryData.socialUsername = socialUsername ?? '';
        entryData.socialPlatform = socialPlatform ?? '';
      } else if (type === 'Item') {
        entryData.address = address ?? '';
      }

      tx.update(creatorRef, { lastCRID: nextNum });
      tx.set(entryRef, entryData);

      return { id: entryRef.id, CR: cr, stageName };
    });

    // Notify OFAM
    const ofamUids = await getOFAMUids();
    if (ofamUids.length > 0) {
      const notifBatch = adminDb.batch();
      for (const uid of ofamUids) {
        notifBatch.set(adminDb.collection('notifications').doc(), {
          userId: uid,
          title: '📷 A New CR has been Created!',
          message: `${caller.displayName ?? token.uid} has added a new CR for ${result.stageName}. Review the details and approve ASAP!`,
          type: 'action',
          read: false,
          dismissedByUser: false,
          createdAt: FieldValue.serverTimestamp(),
          actionUrl: '/creators/custom-requests',
          announcement: false,
          announcementExpiry: null,
        });
      }
      await notifBatch.commit();
    }

    return NextResponse.json({ success: true, id: result.id, CR: result.CR });
  } catch (error: unknown) {
    console.error('[POST /api/campaign-tracking/create]', error);
    return NextResponse.json({ error: 'Failed to create entry' }, { status: 500 });
  }
});
