import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import {
  goLoginErrorResponse,
  requireGoLoginAccess,
  requireGoLoginMember,
  invalidateGoLoginProfiles,
} from '@/lib/services/gologinService';
import {
  getAccountSummary,
  GoLoginLinkError,
  linkGoLoginAccount,
  unlinkGoLoginToken,
} from '@/lib/services/gologinAccountService';
import { GoLoginApiError } from '@/lib/gologin';
import type { DecodedIdToken } from 'firebase-admin/auth';

/**
 * The operator's own GoLogin link.
 *
 * ⚠ **The API token arrives here in a request body and is never sent back.** GET
 * answers with a summary (their GoLogin address, folder, membership state) and
 * deliberately no token — not even a masked one. The only path out of storage is
 * `/api/gologin/launch-token`, which hands it to the Electron main process and
 * nothing else. See `gologinAccountService.ts` for the storage model.
 *
 * **GET is gated on the page permission only, not on membership.** It is the
 * call that *reports* membership, so gating it on membership would leave a
 * non-member unable to be told why they cannot proceed. POST and DELETE, which
 * act, require the seat.
 */
export const maxDuration = 60;

/** GET — "am I a member, have I linked a token, and to what?" */
export const GET = withAuth(async (_req, token: DecodedIdToken) => {
  const denied = await requireGoLoginAccess(token.uid);
  if (denied) return denied;

  try {
    return NextResponse.json(await getAccountSummary(token.uid), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (err) {
    // `getAccountSummary` reaches the provider for an admin (to read the
    // workspace's address and plan), so it can fail for reasons that are not the
    // caller's doing — a missing `GL_API_TOKEN`, a provider outage. Those errors
    // already carry a status and a named cause; without this catch Next
    // flattened them to a bare 500 and the window reported the one thing that
    // was definitely not true, "you have not been added yet".
    return goLoginErrorResponse(err, 'check your GoLogin access');
  }
});

/**
 * POST — link (or re-link) a personal API token.
 *
 * By this point an admin has already granted the seat and created the folder, so
 * this only verifies the token and confirms it belongs to the address the seat
 * was granted to. Idempotent — re-running replaces a rotated token.
 */
export const POST = withAuth(async (req: NextRequest, token: DecodedIdToken) => {
  const denied = (await requireGoLoginAccess(token.uid)) ?? (await requireGoLoginMember(token.uid));
  if (denied) return denied;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body.' }, { status: 400 });
  }

  const apiKey = String((body as { apiKey?: unknown })?.apiKey ?? '').trim();
  if (!apiKey) {
    return NextResponse.json(
      { error: 'Paste your GoLogin API token.', code: 'invalid-key' },
      { status: 400 },
    );
  }
  // A GoLogin token is a JWT. Bounded before it reaches the provider so a paste
  // of the wrong thing entirely costs no request against the rate limit.
  if (apiKey.length < 40 || apiKey.length > 4096 || /\s/.test(apiKey)) {
    return NextResponse.json(
      { error: 'That does not look like a GoLogin API token.', code: 'invalid-key' },
      { status: 400 },
    );
  }

  try {
    await linkGoLoginAccount(token.uid, apiKey);
    // Their visible set just changed from "nothing" to "their folder".
    invalidateGoLoginProfiles(token.uid);
    return NextResponse.json(await getAccountSummary(token.uid), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (err) {
    if (err instanceof GoLoginLinkError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    if (err instanceof GoLoginApiError) {
      console.error('[gologin] link failed', err.status, err.message);
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error('[gologin] link failed', err);
    return NextResponse.json({ error: 'Could not link your GoLogin account.' }, { status: 500 });
  }
});

/**
 * DELETE — forget the token, keeping the seat and the folder.
 *
 * The "my key stopped working" path, not the offboarding one. Removing someone
 * from the workspace is an admin action and lives on `/admin/members`.
 */
export const DELETE = withAuth(async (_req, token: DecodedIdToken) => {
  const denied = (await requireGoLoginAccess(token.uid)) ?? (await requireGoLoginMember(token.uid));
  if (denied) return denied;

  await unlinkGoLoginToken(token.uid);
  invalidateGoLoginProfiles(token.uid);
  return NextResponse.json({ ok: true });
});
