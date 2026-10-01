import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { readJsonBody } from '@/lib/middleware/apiHelpers';
import { isGoLoginId } from '@/lib/gologin';
import { listGoLoginProfilesForMaster, requireGoLoginAccessAnd } from '@/lib/services/gologinService';
import {
  cleanFolderName,
  createFolder,
  deleteFolder,
  listUserFolders,
  manageErrorResponse,
  MAX_FOLDER_PICK,
  parseIdList,
  setFolderProfiles,
  setProfileFolders,
} from '@/lib/services/gologinManageService';
import type { DecodedIdToken } from 'firebase-admin/auth';

/**
 * The workspace's folders — the grouping people actually think in (REPOST,
 * JORGE, …). Bluu's own per-person folders are never listed or writable here;
 * see `isUserFacingFolder`.
 *
 * GET is readable with **any** GoLogin capability, because three surfaces pick
 * folders: New Profile (profiles), Add to Folder / Edit Folders (folders) and
 * Sharing (sharing). `?profiles=1` also returns the workspace's profile list,
 * for the Edit Folders dialog's assignment pane — only that dialog pays for the
 * walk. Every write needs **Create, Edit & Delete Folders**.
 *
 * GoLogin has **no rename endpoint**, so there is no rename here (decided
 * 2026-09-30: an emulated rename is four non-atomic calls that can leave two
 * folders behind). Renaming stays in GoLogin's own app.
 *
 * Not cacheable: a per-user admin read, and every write is immediately re-read.
 */
export const maxDuration = 60;

/** Bounds a hand-picked selection; a real folder is edited a few rows at a time. */
const MAX_BATCH = 200;

export const GET = withAuth(async (req: NextRequest, token: DecodedIdToken) => {
  const denied = await requireGoLoginAccessAnd(token, ['folders', 'profiles', 'sharing']);
  if (denied) return denied;

  const force = req.nextUrl.searchParams.get('refresh') === '1';
  const withProfiles = req.nextUrl.searchParams.get('profiles') === '1';
  try {
    const [folders, list] = await Promise.all([
      listUserFolders(force),
      withProfiles ? listGoLoginProfilesForMaster(force) : Promise.resolve(null),
    ]);
    return NextResponse.json(
      {
        folders,
        ...(list
          ? {
              profiles: list.profiles.map((p) => ({ id: p.id, name: p.name, os: p.os, osSpec: p.osSpec })),
              truncated: list.truncated,
            }
          : {}),
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err) {
    return manageErrorResponse(err, 'load GoLogin folders');
  }
});

/** POST — create a folder: `{ name }`. */
export const POST = withAuth(async (req: NextRequest, token: DecodedIdToken) => {
  const denied = await requireGoLoginAccessAnd(token, 'folders');
  if (denied) return denied;

  const parsed = await readJsonBody(req, 2 * 1024);
  if (!parsed.ok) return parsed.response;
  try {
    const name = cleanFolderName((parsed.body as Record<string, unknown>)?.name);
    return NextResponse.json({ folder: await createFolder(name) }, { status: 201 });
  } catch (err) {
    return manageErrorResponse(err, 'create that folder');
  }
});

/**
 * PATCH — add or remove profiles: `{ folderId, profileIds, action }`. One
 * provider request, addressed by the folder's *current* name resolved from its id.
 */
export const PATCH = withAuth(async (req: NextRequest, token: DecodedIdToken) => {
  const denied = await requireGoLoginAccessAnd(token, 'folders');
  if (denied) return denied;

  const parsed = await readJsonBody(req, 16 * 1024);
  if (!parsed.ok) return parsed.response;
  const body = (parsed.body ?? {}) as Record<string, unknown>;
  const folderId = typeof body.folderId === 'string' ? body.folderId : '';
  const action = body.action;
  const profileIds = parseIdList(body.profileIds, isGoLoginId);

  if (!folderId) return NextResponse.json({ error: 'Which folder?' }, { status: 400 });
  if (action !== 'add' && action !== 'remove') {
    return NextResponse.json({ error: 'Action must be add or remove.' }, { status: 400 });
  }
  if (!profileIds.length) return NextResponse.json({ error: 'No profiles selected.' }, { status: 400 });
  if (profileIds.length > MAX_BATCH) {
    return NextResponse.json({ error: `Too many profiles at once (max ${MAX_BATCH}).` }, { status: 400 });
  }

  try {
    await setFolderProfiles(folderId, profileIds, action);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return manageErrorResponse(err, 'change that folder');
  }
});

/**
 * PUT — put one profile in exactly these folders: `{ profileId, folderIds }`.
 * The row menu's Add to folder. The diff runs server-side against one fresh
 * read (`setProfileFolders`), so the dialog makes one request however many
 * folders changed, and gets back the names the profile ended up in.
 */
export const PUT = withAuth(async (req: NextRequest, token: DecodedIdToken) => {
  const denied = await requireGoLoginAccessAnd(token, 'folders');
  if (denied) return denied;

  const parsed = await readJsonBody(req, 4 * 1024);
  if (!parsed.ok) return parsed.response;
  const body = (parsed.body ?? {}) as Record<string, unknown>;
  if (!isGoLoginId(body.profileId)) return NextResponse.json({ error: 'Unknown profile.' }, { status: 400 });
  const folderIds = parseIdList(body.folderIds);
  if (folderIds.length > MAX_FOLDER_PICK) {
    return NextResponse.json({ error: `Choose at most ${MAX_FOLDER_PICK} folders.` }, { status: 400 });
  }

  try {
    return NextResponse.json({ folders: await setProfileFolders(body.profileId, folderIds) });
  } catch (err) {
    return manageErrorResponse(err, 'change that profile’s folders');
  }
});

/**
 * DELETE — `?id=`. Profiles inside are kept. Members the folder was shared with
 * lose that share first (see `deleteFolder`), and the count is returned so the
 * toast can say so.
 */
export const DELETE = withAuth(async (req: NextRequest, token: DecodedIdToken) => {
  const denied = await requireGoLoginAccessAnd(token, 'folders');
  if (denied) return denied;

  const id = req.nextUrl.searchParams.get('id')?.trim();
  if (!id) return NextResponse.json({ error: 'Which folder?' }, { status: 400 });
  try {
    return NextResponse.json(await deleteFolder(id));
  } catch (err) {
    return manageErrorResponse(err, 'delete that folder');
  }
});
