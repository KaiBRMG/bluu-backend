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
      'pinnedResources',
      'notificationPreferences',
      // TEMPORARY (see CLAUDE.md): marks the stale-TCC screen-recording repair as
      // applied for this user, so the automatic reset never runs a second time.
      'screenshotBugFixed',
    ];

    // screenshotBugFixed is a one-way latch: clients may only ever set it true.
    // Allowing false would let a client re-arm the automatic reset and put itself
    // back into the every-launch OS permission prompt loop.
    if (updates.screenshotBugFixed !== undefined && updates.screenshotBugFixed !== true) {
      return NextResponse.json(
        { error: 'screenshotBugFixed may only be set to true' },
        { status: 400 }
      );
    }

    // Validate pinnedResources: array of strings, capped at 10 (enforced server-side
    // so the limit can't be bypassed by a crafted request).
    const MAX_PINNED_RESOURCES = 10;
    if (updates.pinnedResources !== undefined) {
      const pinned = updates.pinnedResources;
      if (
        !Array.isArray(pinned) ||
        pinned.some((id: unknown) => typeof id !== 'string')
      ) {
        return NextResponse.json(
          { error: 'pinnedResources must be an array of strings' },
          { status: 400 }
        );
      }
      if (pinned.length > MAX_PINNED_RESOURCES) {
        return NextResponse.json(
          { error: `pinnedResources is limited to ${MAX_PINNED_RESOURCES} items` },
          { status: 400 }
        );
      }
    }

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
