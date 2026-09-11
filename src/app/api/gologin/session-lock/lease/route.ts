import { NextRequest, NextResponse } from 'next/server';
import { heartbeatProfileLock, releaseProfileLock } from '@/lib/services/gologinLockService';

/**
 * POST /api/gologin/session-lock/lease — keep a lock alive, or drop it.
 *
 * ## Why this route is not behind `withAuth`
 *
 * **The lease secret IS the access control**, the same construction the public
 * share page uses for its 160-bit share token. A Firebase ID token cannot do the
 * job here: a browser session routinely runs longer than the hour an ID token
 * lasts, and the Electron main process holds no refresh token to mint another —
 * so an authenticated heartbeat would simply start failing mid-session and hand
 * a live profile to the next person who asked for it.
 *
 * What possession of a lease actually grants is deliberately tiny: keep **one
 * lock on one profile** alive, or release it. It reads nothing, it cannot claim
 * a lock (that is the authenticated route), and it names no user. The secret is
 * 256 bits from `randomBytes`, only its SHA-256 is stored, and it is compared in
 * constant time — so it can be neither guessed nor recovered from the database.
 *
 * The worst an attacker holding one could do is release a lock early (allowing
 * the collision the lock prevents) or hold it open (denying one profile until it
 * is force-released). Both are bounded to a single profile, and getting the
 * secret requires already being inside the holder's machine — at which point
 * they have the operator's GoLogin token anyway.
 */
const PROFILE_ID = /^[A-Za-z0-9_-]{6,64}$/;
/** 32 bytes base64url. Bounded before any Firestore work happens. */
const SECRET = /^[A-Za-z0-9_-]{40,64}$/;

export async function POST(req: NextRequest) {
  let body: { action?: unknown; profileId?: unknown; secret?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body.' }, { status: 400 });
  }

  const action = String(body.action ?? '');
  const profileId = String(body.profileId ?? '');
  const secret = String(body.secret ?? '');

  if (action !== 'heartbeat' && action !== 'release') {
    return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
  }
  if (!PROFILE_ID.test(profileId) || !SECRET.test(secret)) {
    // One generic refusal for both, so this cannot be used to probe which
    // profiles have live locks.
    return NextResponse.json({ error: 'Invalid lease.' }, { status: 400 });
  }

  try {
    if (action === 'release') {
      await releaseProfileLock({ profileId, secret });
      return NextResponse.json({ ok: true });
    }
    const held = await heartbeatProfileLock({ profileId, secret });
    // `held: false` is main's signal to tear the session down: the claim expired
    // and someone else may now legitimately hold it.
    return NextResponse.json({ ok: true, held });
  } catch (err) {
    console.error('[gologin] lease action failed', action, err);
    return NextResponse.json({ error: 'Could not update the session lock.' }, { status: 500 });
  }
}
