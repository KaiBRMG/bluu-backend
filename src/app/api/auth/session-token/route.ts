import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { adminDb } from '@/lib/firebase-admin';
import { randomUUID } from 'crypto';
import { getUserById, invalidateUserCache } from '@/lib/services/userService';
import { isValidDeviceId, registerSession } from '@/lib/services/sessionService';
import { FieldValue } from 'firebase-admin/firestore';

/**
 * POST /api/auth/session-token
 *
 * The browser login path. Called after `signInWithPopup` to establish a session
 * for this browser and return the token it stores locally.
 *
 * Two callers, one shape:
 *  • the browser Login screen, and
 *  • "this is me" on a public share page, which links the visitor's browser to
 *    their account so shared links recognise them afterwards.
 *
 * The browser path skips `/api/auth/exchange-code`, so it skips that route's
 * allowlist gate too — this is where the same check has to happen for it. Staff
 * sign in with personal Google accounts now, so being able to complete a Google
 * popup proves nothing about being an employee.
 *
 * **A web login never rotates the legacy `sessionToken`.** It registers a device
 * session and nothing more. Rotating the single legacy token here would displace
 * every Electron renderer still comparing it (rule 9c) the moment anyone linked
 * a browser — a user who did nothing but click a link would be kicked out of the
 * desktop app mid-shift. See lib/services/sessionService.ts.
 */
export const POST = withAuth(async (req: NextRequest, token: DecodedIdToken) => {
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

  const body = await req.json().catch(() => ({}));
  const deviceId = (body as { deviceId?: unknown }).deviceId;
  const deviceLabel = (body as { deviceLabel?: unknown }).deviceLabel;

  if (isValidDeviceId(deviceId)) {
    const { token: sessionToken } = await registerSession({
      uid: token.uid,
      deviceId,
      kind: 'web',
      label: typeof deviceLabel === 'string' ? deviceLabel : undefined,
    });

    await adminDb.collection('users').doc(token.uid).update({
      lastLoginAt: FieldValue.serverTimestamp(),
    });
    invalidateUserCache(token.uid);

    return NextResponse.json({ sessionToken, deviceId });
  }

  // No usable device id (storage blocked, or a client predating device
  // identity). Fall back to the original behaviour — rotate the single token —
  // so this endpoint keeps working rather than refusing the login.
  const sessionToken = randomUUID();

  await adminDb.collection('users').doc(token.uid).update({
    sessionToken,
    lastLoginAt: FieldValue.serverTimestamp(),
  });

  invalidateUserCache(token.uid);

  return NextResponse.json({ sessionToken });
});
