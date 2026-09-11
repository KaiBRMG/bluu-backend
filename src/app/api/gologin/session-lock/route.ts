import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { requireGoLogin, requireGoLoginAdmin } from '@/lib/services/gologinService';
import { claimProfileLock, forceReleaseProfileLock } from '@/lib/services/gologinLockService';
import { getUserById } from '@/lib/services/userService';
import type { DecodedIdToken } from 'firebase-admin/auth';

/**
 * POST /api/gologin/session-lock — claim a profile, or (as an admin) force one open.
 *
 * **Called by the Electron main process**, which owns the browser and is
 * therefore the only thing that knows when a session really starts. The lock is
 * server-side because it has to bind operators on *different machines* — that is
 * the entire failure it prevents. See `gologinLockService.ts`.
 *
 * The identity comes from the verified ID token, never from the body: a caller
 * can name any `profileId` and any `deviceId`, but never another `uid`, so the
 * worst a malicious client manages is fighting over its own locks.
 *
 * A successful claim returns a **lease secret**. Heartbeat and release live on
 * `./lease` and authenticate with that instead of an ID token, because a session
 * routinely outlives one — see that route's header.
 */
const PROFILE_ID = /^[A-Za-z0-9_-]{6,64}$/;
const DEVICE_ID = /^[A-Za-z0-9_:.-]{6,128}$/;

export const POST = withAuth(async (req: NextRequest, token: DecodedIdToken) => {
  const denied = await requireGoLogin(token.uid);
  if (denied) return denied;

  let body: { action?: unknown; profileId?: unknown; deviceId?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body.' }, { status: 400 });
  }

  const action = String(body.action ?? 'claim');
  const profileId = String(body.profileId ?? '');
  if (!PROFILE_ID.test(profileId)) {
    return NextResponse.json({ error: 'Invalid profile id.' }, { status: 400 });
  }

  try {
    if (action === 'force-release') {
      // Tier 3. Taking a profile off a colleague is an override, not an
      // ordinary use of the page permission — see CLAUDE.md rule 3.
      //
      // `requireGoLoginAdmin`, not a bare `token.admin` check, for the reason
      // the Management routes use it: `setCustomUserClaims` does not reach an
      // already-issued ID token, and this renderer routinely runs for weeks
      // without a reload (rule 9c). The button that calls this renders off the
      // live `userData.groups` snapshot, so a bare claim check would show an
      // admin a control that answers "Admins only" — the exact drift already
      // reported once on the Management button.
      const denied = await requireGoLoginAdmin(token);
      if (denied) return denied;
      await forceReleaseProfileLock(profileId);
      return NextResponse.json({ ok: true });
    }

    if (action !== 'claim') {
      return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
    }

    const deviceId = String(body.deviceId ?? '');
    if (!DEVICE_ID.test(deviceId)) {
      return NextResponse.json({ error: 'Invalid device id.' }, { status: 400 });
    }

    // The display name is denormalised onto the lock so a blocked row can say
    // *who* without every client reading every holder's user document.
    const user = await getUserById(token.uid);
    const result = await claimProfileLock({
      profileId,
      uid: token.uid,
      displayName: user?.displayName || user?.workEmail || 'Another user',
      deviceId,
    });
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('[gologin] session lock failed', action, err);
    return NextResponse.json({ error: 'Could not update the session lock.' }, { status: 500 });
  }
});
