import { NextRequest, NextResponse } from 'next/server';
import { google } from 'googleapis';
import { adminAuth } from '@/lib/firebase-admin';
import {
  recordSuccessfulLogin,
  getUserById,
  findUserUidByEmail,
} from '@/lib/services/userService';
import { normalizeEmail } from '@/lib/authEmail';

const oauth2Client = new google.auth.OAuth2(
  process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.NEXT_PUBLIC_REDIRECT_URI || 'http://localhost:3000/auth/callback'
);

/**
 * The single message shown for every "you may not come in" outcome: unknown
 * address, deactivated account, archived account. **Deliberately identical in
 * all three cases** — a distinguishable response would let anyone with a Google
 * account enumerate who works here and who has been let go.
 */
const ACCESS_DENIED = {
  error: 'Login blocked: your account is not in the system. Please contact your team leader.',
  code: 'USER_NOT_REGISTERED',
} as const;

/**
 * Throttle per normalised email. Since the `@bluurock.com` domain check was
 * replaced by the allowlist, this endpoint is reachable by anyone on earth with
 * a Google account, and each call costs a Google token exchange plus a Firestore
 * lookup. In-process only, so it is per-serverless-instance and best-effort —
 * enough to blunt a naive loop, not a substitute for edge rate limiting.
 */
const ATTEMPT_WINDOW_MS = 60_000;
const MAX_ATTEMPTS_PER_WINDOW = 10;
const attempts = new Map<string, { count: number; resetAt: number }>();

function isRateLimited(key: string): boolean {
  const now = Date.now();
  const record = attempts.get(key);

  if (!record || now > record.resetAt) {
    attempts.set(key, { count: 1, resetAt: now + ATTEMPT_WINDOW_MS });
    // Opportunistic sweep so the map can't grow without bound on a warm instance.
    if (attempts.size > 500) {
      for (const [k, v] of attempts) if (now > v.resetAt) attempts.delete(k);
    }
    return false;
  }

  record.count += 1;
  return record.count > MAX_ATTEMPTS_PER_WINDOW;
}

/**
 * POST /api/auth/exchange-code
 *
 * Exchanges a Google OAuth code for a Firebase custom token.
 *
 * **Google authenticates; Firestore authorises.** Google only proves the caller
 * owns an address. Whether that address may enter — and which uid it enters as —
 * comes solely from the `users` collection, which an admin populates ahead of
 * time through the Employee Registry. This route therefore NEVER creates a user
 * document and never provisions an Auth account for an unknown address; an
 * unrecognised email is refused outright.
 *
 * (Before the personal-email migration this gate was `email.endsWith('@bluurock.com')`
 * plus auto-provisioning. With staff on personal Google accounts that test is
 * meaningless, and auto-provisioning would hand an account to any Gmail user.)
 */
export async function POST(request: NextRequest) {
  try {
    const { code } = await request.json();

    if (!code) {
      return NextResponse.json(
        { error: 'Authorization code is required' },
        { status: 400 }
      );
    }

    // Decode the authorization code (it comes URL-encoded from the deep link)
    const decodedCode = decodeURIComponent(code);

    // Exchange authorization code for tokens
    const { tokens } = await oauth2Client.getToken(decodedCode);
    oauth2Client.setCredentials(tokens);

    // Get user info from Google
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const { data: userInfo } = await oauth2.userinfo.get();

    if (!userInfo.email) {
      return NextResponse.json(
        { error: 'Unable to retrieve user email' },
        { status: 400 }
      );
    }

    // An unverified address proves nothing about who owns it, and the address is
    // now the authorisation key. Normal Google accounts are always verified.
    if (userInfo.verified_email === false) {
      console.warn('[exchange-code] rejected unverified Google email');
      return NextResponse.json(ACCESS_DENIED, { status: 403 });
    }

    const email = userInfo.email;
    const key = normalizeEmail(email);
    if (!key) {
      return NextResponse.json(ACCESS_DENIED, { status: 403 });
    }

    if (isRateLimited(key)) {
      return NextResponse.json(
        { error: 'Too many sign-in attempts. Please wait a minute and try again.' },
        { status: 429 }
      );
    }

    // ─── The allowlist gate ─────────────────────────────────────────────
    const uid = await findUserUidByEmail(email);
    if (!uid) {
      console.log(`[exchange-code] rejected unregistered email: ${key}`);
      return NextResponse.json(ACCESS_DENIED, { status: 403 });
    }

    const userDoc = await getUserById(uid);
    if (!userDoc || userDoc.isActive === false || userDoc.isArchived === true) {
      console.log(`[exchange-code] rejected inactive/archived user: ${uid}`);
      return NextResponse.json(ACCESS_DENIED, { status: 403 });
    }

    // ─── Reconcile the Auth account ─────────────────────────────────────
    // The users doc is the source of truth for identity; the Auth account is
    // downstream of it. Two states to repair, both harmless if they never occur:
    //  • account missing — the doc outlived it (an Auth-console deletion that
    //    skipped the app's cascade). Recreate under the SAME uid so all existing
    //    data reattaches instead of stranding the user.
    //  • email stale — a migration whose Firestore half committed and whose Auth
    //    half failed (see migration.md §2.5). Login already works because we key
    //    off the doc; this is the repair pass that closes the gap.
    try {
      const authUser = await adminAuth.getUser(uid);
      if (normalizeEmail(authUser.email) !== key) {
        await adminAuth
          .updateUser(uid, { email })
          .catch((err) => console.error('[exchange-code] Auth email reconcile failed:', err));
      }
    } catch (error: unknown) {
      if ((error as { code?: string })?.code === 'auth/user-not-found') {
        await adminAuth.createUser({
          uid,
          email,
          displayName: userInfo.name || undefined,
          emailVerified: userInfo.verified_email || false,
        });
      } else {
        throw error;
      }
    }

    const sessionToken = await recordSuccessfulLogin({
      uid,
      email,
      googleSub: userInfo.id ?? null,
    });

    // Read AFTER recordSuccessfulLogin, which invalidates the cache — groups may
    // have changed since the read above.
    const freshDoc = await getUserById(uid);
    const isAdmin = Array.isArray(freshDoc?.groups) && freshDoc.groups.includes('admin');

    // Set Custom JWT Claim so Firestore rules can check request.auth.token.admin
    // without a billable Firestore read on every rule evaluation.
    await adminAuth.setCustomUserClaims(uid, { admin: isAdmin });

    const customToken = await adminAuth.createCustomToken(uid, { admin: isAdmin });

    return NextResponse.json({
      customToken,
      sessionToken,
      user: {
        email,
        name: userInfo.name,
      },
    });
  } catch (error: unknown) {
    console.error('[exchange-code] error:', error);
    return NextResponse.json(
      { error: 'Failed to exchange authorization code' },
      { status: 500 }
    );
  }
}
