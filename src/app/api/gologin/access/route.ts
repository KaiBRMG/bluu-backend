import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { requireGoLogin } from '@/lib/services/gologinService';
import type { DecodedIdToken } from 'firebase-admin/auth';

/**
 * GET /api/gologin/access — "may this user open the GoLogin window?"
 *
 * Exists for the **Electron main process**, which spawns the window and cannot
 * read Firestore itself. Main sends the renderer's ID token here and only
 * creates the window on a 200, so the permission is enforced server-side rather
 * than by hiding a sidebar item. Every GoLogin data route re-checks
 * independently — this is the door, not the lock. Mirrors
 * `/api/onlyfans/access`.
 */
export const GET = withAuth(async (_req, token: DecodedIdToken) => {
  // Both gates: the page permission, and a GoLogin workspace seat. The second
  // is not optional — without a seat they cannot generate an API token, so the
  // window would open on an onboarding screen they cannot complete.
  const denied = await requireGoLogin(token.uid);
  if (denied) return denied;
  return NextResponse.json({ ok: true });
});
