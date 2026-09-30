import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { withAuth } from '@/lib/middleware/withAuth';
import { readJsonBody } from '@/lib/middleware/apiHelpers';
import { adminDb } from '@/lib/firebase-admin';
import { isGoLoginId } from '@/lib/gologin';
import { getUserById, invalidateUserCache } from '@/lib/services/userService';
import { requireGoLoginAccess } from '@/lib/services/gologinService';
import type { DecodedIdToken } from 'firebase-admin/auth';

/**
 * POST /api/gologin/pins — pin or unpin a profile: `{ profileId, pinned }`.
 *
 * Pins are **Bluu's, not GoLogin's**, and **per person** (decided 2026-09-30).
 * They live on `users/{uid}.gologinPinnedProfileIds`, which the window already
 * streams via `useUserData`, so reading them costs nothing and a pin shows up in
 * a second open window without a fetch. GoLogin's own `isPinned` flag is
 * deliberately not used: it is one flag per profile shared by everyone.
 *
 * Gated on `apps-gologin` only. Pinning changes nothing but the caller's own
 * view, so it is not a capability — and it needs no provider call, so it costs
 * no GoLogin request budget. The id is validated as a GoLogin id but not checked
 * against the caller's visible profiles: a pin on a profile they cannot see is
 * inert (the window only shows pins it can match), and checking would cost a
 * full profile walk per click.
 *
 * Not cacheable: a write.
 */

/** A generous ceiling; the list is on a document streamed to every window. */
const MAX_PINS = 200;

export const POST = withAuth(async (req: NextRequest, token: DecodedIdToken) => {
  const denied = await requireGoLoginAccess(token.uid);
  if (denied) return denied;

  const parsed = await readJsonBody(req, 1024);
  if (!parsed.ok) return parsed.response;
  const body = (parsed.body ?? {}) as { profileId?: unknown; pinned?: unknown };
  const profileId = typeof body.profileId === 'string' ? body.profileId : '';
  if (!isGoLoginId(profileId) || typeof body.pinned !== 'boolean') {
    return NextResponse.json({ error: 'Expected { profileId, pinned }.' }, { status: 400 });
  }

  if (body.pinned) {
    // `getUserById` is cached 60s — the cap check costs no extra read.
    const user = (await getUserById(token.uid)) as { gologinPinnedProfileIds?: string[] } | null;
    const current = user?.gologinPinnedProfileIds ?? [];
    if (!current.includes(profileId) && current.length >= MAX_PINS) {
      return NextResponse.json(
        { error: `You can pin up to ${MAX_PINS} profiles. Unpin some first.` },
        { status: 409 },
      );
    }
  }

  await adminDb
    .collection('users')
    .doc(token.uid)
    .set(
      {
        gologinPinnedProfileIds: body.pinned
          ? FieldValue.arrayUnion(profileId)
          : FieldValue.arrayRemove(profileId),
      },
      { merge: true },
    );
  invalidateUserCache(token.uid); // rule 2

  return NextResponse.json({ ok: true });
});
