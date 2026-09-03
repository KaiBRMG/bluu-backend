import { NextRequest, NextResponse } from 'next/server';
import { withCreatorAuth } from '@/lib/middleware/withCreatorAuth';
import { adminDb } from '@/lib/firebase-admin';
import { isValidTimezone } from '@/lib/timezone';
import type { DecodedIdToken } from 'firebase-admin/auth';

/**
 * POST /api/creator/timezone
 *
 * Records the creator's device timezone on their own `creators` doc. Called by
 * `CreatorAuthProvider` after sign-in, and only when the detected zone differs
 * from the stored one.
 *
 * The device is the source of truth for `defaultTimezone`: every due date in the
 * product resolves against it, and a creator's own device knows where they are
 * better than an admin picking from a list. It is therefore written here rather
 * than in the admin UI, which displays it read-only.
 *
 * Scope is deliberately narrow — a creator can write exactly one field, on
 * exactly their own document, and only a value this runtime recognises as a real
 * IANA zone. `withCreatorAuth` has already proven the token and that the account
 * is an active creator; `token.uid` is the creator id, so there is no
 * client-supplied identifier to tamper with.
 */
export const POST = withCreatorAuth(async (request: NextRequest, token: DecodedIdToken) => {
  try {
    const body = await request.json().catch(() => ({})) as { timezone?: unknown };
    const { timezone } = body;

    // Never trust a zone name off the wire: it goes straight into `Intl` calls
    // and onto a record other surfaces render deadlines from.
    if (!isValidTimezone(timezone)) {
      return NextResponse.json({ error: 'Invalid timezone' }, { status: 400 });
    }

    const docRef = adminDb.collection('creators').doc(token.uid);
    const snap = await docRef.get();
    if (!snap.exists) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    // The client already guards on this; re-checking here keeps a buggy or
    // replayed client from writing on every page load (cross-cutting rule 9).
    if (snap.data()?.defaultTimezone === timezone) {
      return NextResponse.json({ success: true, timezone, changed: false });
    }

    await docRef.update({ defaultTimezone: timezone });

    return NextResponse.json({ success: true, timezone, changed: true });
  } catch (error) {
    console.error('[creator/timezone POST]', error);
    return NextResponse.json({ error: 'Failed to save timezone' }, { status: 500 });
  }
});
