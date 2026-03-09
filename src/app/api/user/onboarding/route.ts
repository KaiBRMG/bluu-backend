import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { adminDb } from '@/lib/firebase-admin';
import { invalidateUserCache } from '@/lib/services/userService';
import type { DecodedIdToken } from 'firebase-admin/auth';

export const PATCH = withAuth(async (request: NextRequest, token: DecodedIdToken) => {
  try {
    const body = await request.json();
    const updates: Record<string, boolean> = {};

    // Only allow setting these flags to true — never allow reverting to false
    if (body.hasAcceptedTerms === true) updates.hasAcceptedTerms = true;
    if (body.hasCompletedOnboarding === true) updates.hasCompletedOnboarding = true;

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
    }

    await adminDb.collection('users').doc(token.uid).update(updates);
    invalidateUserCache(token.uid);

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error('[user/onboarding] error:', error);
    return NextResponse.json({ error: 'Failed to update onboarding status' }, { status: 500 });
  }
});
