import { NextRequest, NextResponse } from 'next/server';
import { google } from 'googleapis';
import { withAuth } from '@/lib/middleware/withAuth';
import { adminDb, adminAuth } from '@/lib/firebase-admin';
import {
  getUserById,
  invalidateUserCache,
  claimEmailInTransaction,
} from '@/lib/services/userService';
import { invalidateAdminUsersCache } from '@/app/api/admin/users/route';
import { invalidateDisplayNamesCache } from '@/app/api/users/display-names/route';
import { normalizeEmail, isLegacyWorkEmail } from '@/lib/authEmail';
import { isEmailReversalCohort } from '@/lib/emailMigrationConfig';
import { FieldValue } from 'firebase-admin/firestore';
import type { DecodedIdToken } from 'firebase-admin/auth';

const oauth2Client = new google.auth.OAuth2(
  process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.NEXT_PUBLIC_REDIRECT_URI || 'http://localhost:3000/auth/callback'
);

/**
 * POST /api/auth/migrate-email
 *
 * The one-time move from a `@bluurock.com` address to the user's own Google
 * account. Called with an OAuth code the user obtained by signing in *as the new
 * account* — which is what proves they own it. The caller must already be signed
 * in as themselves (`withAuth`), so this can only ever change the caller's own
 * address; the uid never changes, which is why the session survives it.
 *
 * ── Write order matters, and is not interchangeable ──────────────────────────
 * The Firestore doc + email index commit FIRST, in one transaction; the Firebase
 * Auth account is updated after, and a failure there is logged, not fatal.
 *
 * The other order looks equivalent and is not. Login resolves the uid from the
 * `users` doc, so:
 *   • doc committed, Auth failed  → login by the NEW address already works. The
 *     stale Auth record is cosmetic and self-heals on the next login (see the
 *     reconcile block in exchange-code).
 *   • Auth committed, doc failed  → the old address is gone from Auth and the
 *     new one was never registered. The user can log in with NEITHER. That is a
 *     hard lockout needing admin recovery, from a transient network blip.
 * Never reorder these.
 *
 * ── `mode: 'revert'` — the same move, backwards ──────────────────────────────
 * For a user migrated by mistake (wrong group membership swept them into a
 * cohort). Identical machinery and identical write order; only the domain gate
 * flips — the new address must now BE a `@bluurock.com` one. Two things keep it
 * from being a hole in the allowlist:
 *   • The caller must be listed in `EMAIL_MIGRATION_REVERSAL` server-side. The
 *     client cannot opt itself in.
 *   • Ownership is still proven by OAuth, so a reverting user can only land on a
 *     company address they can actually sign into, and the collision checks
 *     below are unchanged — a company address held by someone else is refused.
 */
export const POST = withAuth(async (request: NextRequest, token: DecodedIdToken) => {
  try {
    const { code, mode } = await request.json();
    if (!code) {
      return NextResponse.json({ error: 'Authorization code is required' }, { status: 400 });
    }

    const isRevert = mode === 'revert';
    if (isRevert && !isEmailReversalCohort(token.uid)) {
      return NextResponse.json({ error: 'Not permitted' }, { status: 403 });
    }

    const currentUser = await getUserById(token.uid);
    if (!currentUser) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // ─── Who did they just sign in as? ──────────────────────────────────
    const { tokens } = await oauth2Client.getToken(decodeURIComponent(code));
    oauth2Client.setCredentials(tokens);
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const { data: userInfo } = await oauth2.userinfo.get();

    const email = userInfo.email;
    if (!email || userInfo.verified_email === false) {
      return NextResponse.json(
        { error: 'Could not verify that Google account. Please try again.' },
        { status: 400 },
      );
    }

    const key = normalizeEmail(email);
    if (!key) {
      return NextResponse.json({ error: 'That address is not usable.' }, { status: 400 });
    }

    // ─── The "you picked the wrong account" gate ────────────────────────
    // Google has no way to *constrain* the account chooser to (or away from) a
    // domain, so this can only be caught here, after the fact. The client
    // re-prompts. The reversal wants the exact opposite address to the
    // migration, so the test inverts with it.
    if (!isRevert && isLegacyWorkEmail(email)) {
      return NextResponse.json(
        {
          error: 'That is your company email. Choose your personal Google account instead.',
          code: 'STILL_WORK_EMAIL',
        },
        { status: 409 },
      );
    }
    if (isRevert && !isLegacyWorkEmail(email)) {
      return NextResponse.json(
        {
          error: 'That is not your company email. Choose your @bluurock.com account instead.',
          code: 'NOT_WORK_EMAIL',
        },
        { status: 409 },
      );
    }

    const oldEmail: string | undefined = currentUser.workEmail;
    const oldKey = normalizeEmail(oldEmail);
    if (oldKey === key) {
      return NextResponse.json(
        {
          error: 'That is the address you already use. Choose a different Google account.',
          code: 'STILL_WORK_EMAIL',
        },
        { status: 409 },
      );
    }

    // ─── Is the address free? ───────────────────────────────────────────
    // One call covers every kind of collision: another employee, a creator (they
    // sign in with email/password against the same Auth project), or leftover
    // test accounts. Anything resolving to a different uid is a hard no.
    try {
      const existingAuth = await adminAuth.getUserByEmail(email);
      if (existingAuth.uid !== token.uid) {
        return NextResponse.json(
          {
            error: 'That Google account is already linked to another Bluu account.',
            code: 'EMAIL_TAKEN',
          },
          { status: 409 },
        );
      }
    } catch (error: unknown) {
      if ((error as { code?: string })?.code !== 'auth/user-not-found') throw error;
      // Not found is the happy path: nobody holds this address.
    }

    // ─── Commit: claim the new address, release the old, update the doc ──
    try {
      await adminDb.runTransaction(async (tx) => {
        // Belt and braces alongside the index claim: catches a users doc that
        // holds this address without a matching index entry (possible only if
        // the backfill has not run). Without it, the migrator would win the
        // index and silently lock the other user out of their own account.
        const clash = await tx.get(
          adminDb.collection('users').where('workEmail', '==', email).limit(1),
        );
        if (!clash.empty && clash.docs[0].id !== token.uid) {
          throw new Error('EMAIL_TAKEN');
        }

        await claimEmailInTransaction(tx, {
          uid: token.uid,
          email,
          releaseKey: oldKey || undefined,
        });

        tx.update(adminDb.collection('users').doc(token.uid), {
          workEmail: email,
          googleSub: userInfo.id ?? null,
          // Audit trail: which address this account used to answer to. Cheap,
          // and the only record of it once the index entry is released.
          previousWorkEmail: oldEmail ?? null,
          // A reversal un-does the migration, so `emailMigratedAt` must go with
          // it — leaving it set would report this user as migrated on every
          // surface that reads it, and would misreport progress if the fleet is
          // ever audited by that field.
          ...(isRevert
            ? {
                emailMigratedAt: FieldValue.delete(),
                emailRevertedAt: FieldValue.serverTimestamp(),
              }
            : { emailMigratedAt: FieldValue.serverTimestamp() }),
        });
      });
    } catch (error: unknown) {
      if ((error as Error)?.message === 'EMAIL_TAKEN') {
        return NextResponse.json(
          {
            error: 'That Google account is already linked to another Bluu account.',
            code: 'EMAIL_TAKEN',
          },
          { status: 409 },
        );
      }
      throw error;
    }

    invalidateUserCache(token.uid);
    invalidateAdminUsersCache();
    invalidateDisplayNamesCache();

    // Non-fatal by design — see the header. Login already works off the doc.
    await adminAuth.updateUser(token.uid, { email }).catch((err) => {
      console.error(
        `[migrate-email] Firestore migrated but Auth update failed for ${token.uid} — ` +
        'login still works via the users doc; exchange-code reconciles on next login.',
        err,
      );
    });

    console.log(`[migrate-email] ${token.uid} ${isRevert ? 'reverted' : 'migrated'} to ${key}`);
    return NextResponse.json({ success: true, email });
  } catch (error: unknown) {
    console.error('[migrate-email] error:', error);
    return NextResponse.json({ error: 'Failed to update your email' }, { status: 500 });
  }
});
