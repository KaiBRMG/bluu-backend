import { NextRequest, NextResponse } from 'next/server';
import { adminAuth } from '@/lib/firebase-admin';
import { getUserById } from '@/lib/services/userService';
import type { DecodedIdToken } from 'firebase-admin/auth';

export type AuthedHandler<TParams = undefined> = TParams extends undefined
  ? (req: NextRequest, token: DecodedIdToken) => Promise<NextResponse>
  : (req: NextRequest, token: DecodedIdToken, params: Promise<TParams>) => Promise<NextResponse>;

/**
 * The refusal for a valid token that is not an active employee. Same body and
 * status as `/api/auth/exchange-code`'s, so neither path distinguishes "never
 * registered" from "deactivated" (no staff enumeration), and so the browser
 * login — whose `session-token` call lands here first — shows its "not in the
 * system" state.
 */
const NOT_STAFF = {
  error: 'Login blocked: your account is not in the system. Please contact your team leader.',
  code: 'USER_NOT_REGISTERED',
} as const;

/**
 * Wraps a route handler with employee authentication.
 *
 * **A valid Firebase ID token is NOT proof of being an employee**, which is why
 * this does more than `verifyIdToken`. Three kinds of valid token exist in this
 * project that must never reach an employee route:
 *
 *  - **Telegram creator sessions** (`tg: true`) — creators are external parties
 *    and have their own guard, `withCreatorAuth`. Refused on the claim, before
 *    any read.
 *  - **Any Google account.** The browser login runs `signInWithPopup` before
 *    the allowlist is consulted, so Firebase Auth creates an account and issues
 *    a token for whoever signs in; the allowlist refusal comes after. That
 *    token is real and outlives the client-side sign-out.
 *  - **Offboarded employees.** Deactivation revokes refresh tokens, but an ID
 *    token already issued stays valid for up to an hour.
 *
 * All three fail the same test: there is no active, unarchived `users` doc
 * behind the uid. `getUserById` is cached (60s per instance) and nearly every
 * route reads the caller's doc anyway, so this is usually a cache hit rather
 * than an extra Firestore read (rule 9). The admin deactivate path invalidates
 * that cache, so a refusal is immediate on the instance that handled it and
 * within 60s everywhere else.
 */
export function withAuth(
  handler: (req: NextRequest, token: DecodedIdToken) => Promise<NextResponse>
): (req: NextRequest) => Promise<NextResponse>;

export function withAuth<TParams>(
  handler: (req: NextRequest, token: DecodedIdToken, params: Promise<TParams>) => Promise<NextResponse>
): (req: NextRequest, context: { params: Promise<TParams> }) => Promise<NextResponse>;

export function withAuth(handler: Function) {
  return async (req: NextRequest, context?: { params: unknown }) => {
    const authHeader = req.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Missing authorization token' }, { status: 401 });
    }

    const idToken = authHeader.slice(7);

    let token: DecodedIdToken;
    try {
      token = await adminAuth.verifyIdToken(idToken);
    } catch (error: unknown) {
      const code = (error as { code?: string })?.code;
      if (code === 'auth/id-token-expired') {
        return NextResponse.json({ error: 'Session expired' }, { status: 401 });
      }
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    if (token.tg === true) {
      return NextResponse.json(NOT_STAFF, { status: 403 });
    }

    const user = await getUserById(token.uid);
    if (!user || user.isActive === false || user.isArchived === true) {
      return NextResponse.json(NOT_STAFF, { status: 403 });
    }

    return context !== undefined
      ? handler(req, token, context.params)
      : handler(req, token);
  };
}
