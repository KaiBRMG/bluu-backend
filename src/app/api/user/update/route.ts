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
    ];

    // Filter and sanitize updates
    const sanitizedUpdates: Record<string, unknown> = {};

    for (const field of allowedFields) {
      if (updates[field] !== undefined) {
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
    console.error('Error updating user:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: errorMessage || 'Failed to update user' },
      { status: 500 }
    );
  }
});
