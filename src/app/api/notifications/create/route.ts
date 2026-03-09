import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { adminDb } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import type { DecodedIdToken } from 'firebase-admin/auth';

type NotificationType = 'onboarding' | 'system' | 'shift' | 'alert' | 'success' | 'action';

const ALLOWED_TYPES: NotificationType[] = ['onboarding', 'system', 'shift', 'alert', 'success', 'action'];

export const POST = withAuth(async (request: NextRequest, token: DecodedIdToken) => {
  try {
    const body = await request.json();
    const { title, message, type } = body as { title: string; message: string; type: NotificationType };

    if (!title || !message || !ALLOWED_TYPES.includes(type)) {
      return NextResponse.json({ error: 'Missing or invalid fields' }, { status: 400 });
    }

    await adminDb.collection('notifications').add({
      userId: token.uid,
      title,
      message,
      type,
      read: false,
      dismissedByUser: false,
      createdAt: FieldValue.serverTimestamp(),
      actionUrl: null,
      announcement: false,
      announcementExpiry: null,
    });

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error('[notifications/create] error:', error);
    return NextResponse.json({ error: 'Failed to create notification' }, { status: 500 });
  }
});
