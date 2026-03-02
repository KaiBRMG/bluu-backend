import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { adminDb } from '@/lib/firebase-admin';
import { invalidateUserCache } from '@/lib/services/userService';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import type { DecodedIdToken } from 'firebase-admin/auth';

export const POST = withAuth(async (request: NextRequest, token: DecodedIdToken) => {
  try {
    // Parse request body
    const updates = await request.json();

    // Whitelist of allowed fields to update (prevent unauthorized field updates)
    const allowedFields = [
      'displayName',
      'address',
      'gender',
      'DOB',
      'contactInfo',
      'paymentMethod',
      'paymentInfo',
      'userComments',
      'photoURL',
      'timezone',
      'timezoneOffset',
      'additionalTimezones',
      'notificationPreferences',
    ];

    // Maximum byte lengths for free-text string fields
    const STRING_MAX_LENGTHS: Record<string, number> = {
      displayName: 100,
      gender: 50,
      paymentMethod: 100,
      paymentInfo: 500,
      userComments: 2000,
      timezone: 100,
      timezoneOffset: 10,
      photoURL: 2048,
    };

    // Filter and sanitize updates
    const sanitizedUpdates: Record<string, unknown> = {};

    for (const field of allowedFields) {
      if (updates[field] !== undefined) {
        // Enforce max length on top-level string fields
        if (typeof updates[field] === 'string' && STRING_MAX_LENGTHS[field] !== undefined) {
          if (updates[field].length > STRING_MAX_LENGTHS[field]) {
            return NextResponse.json(
              { error: `${field} exceeds maximum length of ${STRING_MAX_LENGTHS[field]}` },
              { status: 400 }
            );
          }
        }

        // Handle DOB timestamp conversion
        if (field === 'DOB' && updates[field]) {
          sanitizedUpdates[field] = Timestamp.fromDate(new Date(updates[field]));
        } else if (field === 'DOB' && !updates[field]) {
          sanitizedUpdates[field] = null;
        } else {
          sanitizedUpdates[field] = updates[field];
        }
      }
    }

    // Update the user document
    const userRef = adminDb.collection('users').doc(token.uid);
    await userRef.update({
      ...sanitizedUpdates,
      updatedAt: FieldValue.serverTimestamp(),
    });
    invalidateUserCache(token.uid);

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error('[user/update] error:', error);
    return NextResponse.json({ error: 'Failed to update user' }, { status: 500 });
  }
});
