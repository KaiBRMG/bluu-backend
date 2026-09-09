import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { requireGoLoginAccess } from '@/lib/services/gologinService';
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
  const denied = await requireGoLoginAccess(token.uid);
  if (denied) return denied;
  return NextResponse.json({ ok: true });
});
