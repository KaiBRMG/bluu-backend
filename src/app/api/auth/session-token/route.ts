import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { adminDb } from '@/lib/firebase-admin';
import { randomUUID } from 'crypto';
import { getUserById, invalidateUserCache } from '@/lib/services/userService';
import { FieldValue } from 'firebase-admin/firestore';

/**
 * POST /api/auth/session-token
 * Called after browser-based (signInWithPopup) login to rotate the sessionToken
 * on the user document, displacing any existing session on another device.
 * Returns the new sessionToken so the client can store it locally.
 *
 * The browser path skips `/api/auth/exchange-code`, so it skips that route's
 * allowlist gate too — this is where the same check has to happen for it. Staff
 * sign in with personal Google accounts now, so being able to complete a Google
 * popup proves nothing about being an employee.
 */
export const POST = withAuth(async (_req: NextRequest, token: DecodedIdToken) => {
  const user = await getUserById(token.uid);
  if (!user || user.isActive === false || user.isArchived === true) {
    // Same wording and status as exchange-code's refusal, for the same reason:
    // the response must not distinguish "never registered" from "deactivated".
    return NextResponse.json(
      {
        error: 'Login blocked: your account is not in the system. Please contact your team leader.',
        code: 'USER_NOT_REGISTERED',
      },
      { status: 403 },
    );
  }

  const sessionToken = randomUUID();

  await adminDb.collection('users').doc(token.uid).update({
    sessionToken,
    lastLoginAt: FieldValue.serverTimestamp(),
  });

  invalidateUserCache(token.uid);

  return NextResponse.json({ sessionToken });
});
