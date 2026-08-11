import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { requireOnlyFansAccess } from '@/lib/services/onlyfansService';
import type { DecodedIdToken } from 'firebase-admin/auth';

/**
 * GET /api/onlyfans/access — "may this user open OF Manager?"
 *
 * Exists for the **Electron main process**, which spawns the OF Manager window
 * and cannot read Firestore itself. Main posts the renderer's ID token here and
 * only creates the window on a 200, so the permission is enforced server-side
 * rather than by hiding a sidebar item. Every OnlyFans data route re-checks
 * independently — this is the door, not the lock.
 */
export const GET = withAuth(async (_req, token: DecodedIdToken) => {
  const denied = await requireOnlyFansAccess(token.uid);
  if (denied) return denied;
  return NextResponse.json({ ok: true });
});
