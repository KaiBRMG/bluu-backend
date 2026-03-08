import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { adminDb } from '@/lib/firebase-admin';
import { randomUUID } from 'crypto';
import { invalidateUserCache } from '@/lib/services/userService';
import { FieldValue } from 'firebase-admin/firestore';

/**
 * POST /api/auth/session-token
 * Called after browser-based (signInWithPopup) login to rotate the sessionToken
 * on the user document, displacing any existing session on another device.
 * Returns the new sessionToken so the client can store it locally.
 */
export const POST = withAuth(async (_req: NextRequest, token: DecodedIdToken) => {
  const sessionToken = randomUUID();

  await adminDb.collection('users').doc(token.uid).update({
    sessionToken,
    lastLoginAt: FieldValue.serverTimestamp(),
  });

  invalidateUserCache(token.uid);

  return NextResponse.json({ sessionToken });
});
