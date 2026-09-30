import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { isGoLoginId } from '@/lib/gologin';
import { requireGoLoginAccessAnd } from '@/lib/services/gologinService';
import { manageErrorResponse, restoreProfile } from '@/lib/services/gologinManageService';
import type { DecodedIdToken } from 'firebase-admin/auth';

/**
 * POST /api/gologin/manage/profiles/{id}/restore — the Undo behind a delete.
 *
 * GoLogin keeps deleted profiles restorable (`POST /deleted-profiles/restore`),
 * which is what makes the toast's Undo an honest one rather than a promise the
 * system cannot keep. Same gate as deleting. Not cacheable: a write.
 */
export const maxDuration = 30;

export const POST = withAuth<{ id: string }>(async (_req: NextRequest, token: DecodedIdToken, params) => {
  const denied = await requireGoLoginAccessAnd(token, 'profiles');
  if (denied) return denied;
  const { id } = await params;
  if (!isGoLoginId(id)) return NextResponse.json({ error: 'Unknown profile.' }, { status: 400 });

  try {
    await restoreProfile(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return manageErrorResponse(err, 'restore that GoLogin profile');
  }
});
