import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { readJsonBody } from '@/lib/middleware/apiHelpers';
import { requireGoLoginAccessAnd } from '@/lib/services/gologinService';
import {
  getSharingOverview,
  manageErrorResponse,
  parseIdList,
  shareFolders,
  shareProfiles,
} from '@/lib/services/gologinManageService';
import type { DecodedIdToken } from 'firebase-admin/auth';

/**
 * Sharing — who can open which profiles and folders. Replaced Management's
 * "Profile access" tab on 2026-09-30.
 *
 * Gated on `apps-gologin` plus **Share Profiles & Folders** (admins always):
 * every write here hands out, or takes back, live logged-in accounts.
 *
 * **A shared folder is live.** Sharing a folder re-scopes the member's GoLogin
 * seat to include it, so profiles added to it later reach them with nothing
 * further to do — the old tab copied a folder's contents at that moment, and a
 * later addition never followed. **A shared profile is a single grant** into the
 * member's personal folder. See `gologinManageService.ts` § Sharing.
 *
 * Not cacheable: per-user admin data, re-read after every write.
 */
export const maxDuration = 120;

/** Sequential member writes; this bounds how long one request can run. */
const MAX_MEMBERS = 25;
const MAX_ITEMS = 200;

export const GET = withAuth(async (req: NextRequest, token: DecodedIdToken) => {
  const denied = await requireGoLoginAccessAnd(token, 'sharing');
  if (denied) return denied;
  const force = req.nextUrl.searchParams.get('refresh') === '1';
  try {
    return NextResponse.json(await getSharingOverview(force), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (err) {
    return manageErrorResponse(err, 'load sharing');
  }
});

/**
 * POST — `{ kind: 'folders' | 'profiles', uids, ids, action: 'add' | 'remove' }`.
 * Returns `{ done, failed[] }`: one member whose seat has gone must not stop the
 * change for everyone else, and must not be reported as a success either.
 */
export const POST = withAuth(async (req: NextRequest, token: DecodedIdToken) => {
  const denied = await requireGoLoginAccessAnd(token, 'sharing');
  if (denied) return denied;

  const parsed = await readJsonBody(req, 32 * 1024);
  if (!parsed.ok) return parsed.response;
  const body = (parsed.body ?? {}) as Record<string, unknown>;

  const kind = body.kind;
  const action = body.action;
  const uids = parseIdList(body.uids);
  const ids = parseIdList(body.ids);

  if (kind !== 'folders' && kind !== 'profiles') {
    return NextResponse.json({ error: 'Share folders or profiles?' }, { status: 400 });
  }
  if (action !== 'add' && action !== 'remove') {
    return NextResponse.json({ error: 'Action must be add or remove.' }, { status: 400 });
  }
  if (!uids.length || !ids.length) {
    return NextResponse.json({ error: 'Pick at least one person and one item.' }, { status: 400 });
  }
  if (uids.length > MAX_MEMBERS || ids.length > MAX_ITEMS) {
    return NextResponse.json(
      { error: `Too many at once (max ${MAX_MEMBERS} people, ${MAX_ITEMS} items).` },
      { status: 400 },
    );
  }

  try {
    const outcome =
      kind === 'folders'
        ? await shareFolders({ uids, folderIds: ids, action })
        : await shareProfiles({ uids, profileIds: ids, action });
    return NextResponse.json(outcome);
  } catch (err) {
    return manageErrorResponse(err, 'change sharing');
  }
});
