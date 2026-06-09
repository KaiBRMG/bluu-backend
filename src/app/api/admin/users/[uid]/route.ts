import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { adminDb } from '@/lib/firebase-admin';
import { getUserById, invalidateUserCache } from '@/lib/services/userService';
import { invalidateAdminUsersCache } from '@/app/api/admin/users/route';
import { invalidateDisplayNamesCache } from '@/app/api/users/display-names/route';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { randomUUID } from 'crypto';
import type { DecodedIdToken } from 'firebase-admin/auth';

/**
 * PUT /api/admin/users/[uid]
 * Admin-only. Updates any user's profile fields.
 * Does NOT handle group membership — use /api/admin/groups/[groupId]/members for that.
 */
export const PUT = withAuth(async (
  request: NextRequest,
  token: DecodedIdToken,
  params: Promise<{ uid: string }>
) => {
  try {
    const caller = await getUserById(token.uid);
    if (!caller?.permittedPageIds?.includes('user-management')) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const { uid: targetUid } = await params;
    const updates = await request.json();

    const effectiveFields = [
      'firstName',
      'lastName',
      'displayName',
      'gender',
      'DOB',
      'jobTitle',
      'employmentType',
      'address',
      'contactInfo',
      'paymentMethod',
      'paymentInfo',
      'userComments',
      'photoURL',
      'enableIdleTimeout',
      'enableScreenshots',
      'hasPaidLeave',
      'remainingUnpaidLeave',
      'remainingPaidLeave',
      'isActive',
    ];

    // Filter and sanitize updates
    const sanitizedUpdates: Record<string, unknown> = {};

    for (const field of effectiveFields) {
      if (updates[field] !== undefined) {
        if (field === 'DOB' && updates[field]) {
          sanitizedUpdates[field] = Timestamp.fromDate(new Date(updates[field]));
        } else if (field === 'DOB' && !updates[field]) {
          sanitizedUpdates[field] = null;
        } else {
          sanitizedUpdates[field] = updates[field];
        }
      }
    }

    if (Object.keys(sanitizedUpdates).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
    }

    // Rotating sessionToken forces an immediate sign-out via the onSnapshot
    // mismatch check in useUserData — required when deactivating an account.
    if (sanitizedUpdates.isActive === false) {
      sanitizedUpdates.sessionToken = randomUUID();
    }

    const userRef = adminDb.collection('users').doc(targetUid);
    await userRef.update({
      ...sanitizedUpdates,
      updatedAt: FieldValue.serverTimestamp(),
    });
    invalidateUserCache(targetUid);
    invalidateAdminUsersCache();
    invalidateDisplayNamesCache();

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error('Error updating user:', error);
    return NextResponse.json({ error: 'Failed to update user' }, { status: 500 });
  }
});
