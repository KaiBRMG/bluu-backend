import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/lib/firebase-admin';
import type { DecodedIdToken } from 'firebase-admin/auth';

/**
 * Wraps a route handler with Firebase token verification for creator portal API routes.
 * Verifies the Bearer token, checks it was minted by the Telegram exchange, then
 * checks the caller exists in the creators collection and is active.
 * Returns 401 for missing/invalid tokens and 403 for non-Telegram sessions,
 * non-creator accounts, or inactive accounts.
 *
 * ── The `tg` claim is the session lock ──────────────────────────────────────
 *
 * **The creator portal is reachable only from inside Telegram, and this is where
 * that is enforced** — not in the shell, which is just a renderer anyone can
 * bypass by calling the API directly.
 *
 * `POST /api/creator/telegram/session` is the only thing that can mint a token
 * carrying `tg: true`: it does so only after verifying Telegram's `initData`
 * signature against the bot token. So a session obtained any other way is
 * refused here, and there are two such ways that genuinely exist:
 *
 *  - **Leftover email/password credentials.** Creator Auth accounts still hold
 *    the passwords they were created with (a deliberate decision — see auth.md),
 *    and the Firebase web config is public. Without this check, a leaked
 *    password is full API access from any browser.
 *  - **Refresh tokens from before the cutover.** A creator signed in on their
 *    phone browser during the password era can keep minting valid ID tokens
 *    indefinitely. Those tokens are perfectly valid; they simply have no `tg`.
 *
 * **`checkRevoked` is deliberately NOT used.** It would add a round trip to
 * Google's Identity service on every creator API call, and it buys nothing here:
 * the sessions it would catch are exactly the ones already refused for having no
 * `tg` claim. Revocation is still run once, as a flush — see
 * `scripts/revoke-creator-sessions.js` — because it also ends those sessions on
 * the *client*, rather than leaving them signed in and failing every request.
 */
export function withCreatorAuth(
  handler: (req: NextRequest, token: DecodedIdToken) => Promise<NextResponse>
): (req: NextRequest) => Promise<NextResponse>;

export function withCreatorAuth<TParams>(
  handler: (req: NextRequest, token: DecodedIdToken, params: Promise<TParams>) => Promise<NextResponse>
): (req: NextRequest, context: { params: Promise<TParams> }) => Promise<NextResponse>;

export function withCreatorAuth(handler: Function) {
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

    // The session lock. Checked BEFORE the Firestore read: a token that did not
    // come from Telegram is refused without spending a read on it.
    if (token.tg !== true) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    // Verify the user is an active creator
    const creatorDoc = await adminDb.collection('creators').doc(token.uid).get();
    if (!creatorDoc.exists) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }
    if (creatorDoc.data()?.isActive === false) {
      return NextResponse.json({ error: 'Account is inactive' }, { status: 403 });
    }

    return context !== undefined
      ? handler(req, token, context.params)
      : handler(req, token);
  };
}
