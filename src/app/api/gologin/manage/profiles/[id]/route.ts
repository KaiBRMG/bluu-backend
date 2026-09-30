import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { readJsonBody } from '@/lib/middleware/apiHelpers';
import { isGoLoginId } from '@/lib/gologin';
import { requireGoLoginAccessAnd, requireGoLoginCapability } from '@/lib/services/gologinService';
import {
  cleanNotes,
  cleanProfileName,
  deleteProfile,
  getProfileForEdit,
  manageErrorResponse,
  MAX_FOLDER_PICK,
  parseIdList,
  parseProxyInput,
  updateProfile,
  type ProfileUpdate,
} from '@/lib/services/gologinManageService';
import type { DecodedIdToken } from 'firebase-admin/auth';

/**
 * One profile, for the Edit panel and the Delete action.
 *
 * All three verbs are gated on `apps-gologin` plus **Create, Edit & Delete
 * Profiles**; changing a profile's folders additionally needs **Create, Edit &
 * Delete Folders**, the capability that owns folder membership everywhere else.
 *
 * ⚠ The GET returns the *manager's* projection (`GoLoginProfileDetail`): the
 * proxy password is reduced to `hasPassword` and never leaves the server.
 *
 * Not cacheable: the detail is read to be edited, and a stale copy is exactly
 * what would be written back over someone else's change.
 */
export const maxDuration = 60;

type Params = { id: string };

export const GET = withAuth<Params>(async (_req: NextRequest, token: DecodedIdToken, params) => {
  const denied = await requireGoLoginAccessAnd(token, 'profiles');
  if (denied) return denied;
  const { id } = await params;
  if (!isGoLoginId(id)) return NextResponse.json({ error: 'Unknown profile.' }, { status: 400 });

  try {
    return NextResponse.json(await getProfileForEdit(id), { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return manageErrorResponse(err, 'load that GoLogin profile');
  }
});

/**
 * PATCH — `{ name?, notes?, proxy?: {...} | null, folderIds? }`. Only the keys
 * present are changed, each through an endpoint scoped to that field. Returns
 * the refreshed list row so the window can update in place without re-walking
 * every profile.
 */
export const PATCH = withAuth<Params>(async (req: NextRequest, token: DecodedIdToken, params) => {
  const denied = await requireGoLoginAccessAnd(token, 'profiles');
  if (denied) return denied;
  const { id } = await params;
  if (!isGoLoginId(id)) return NextResponse.json({ error: 'Unknown profile.' }, { status: 400 });

  const parsed = await readJsonBody(req, 8 * 1024);
  if (!parsed.ok) return parsed.response;
  const body = (parsed.body ?? {}) as Record<string, unknown>;

  try {
    const update: ProfileUpdate = {};
    if ('name' in body) update.name = cleanProfileName(body.name);
    if ('notes' in body) update.notes = cleanNotes(body.notes);
    if ('proxy' in body) update.proxy = body.proxy === null ? null : parseProxyInput(body.proxy);
    if ('folderIds' in body) {
      const foldersDenied = await requireGoLoginCapability(token, 'folders');
      if (foldersDenied) return foldersDenied;
      update.folderIds = parseIdList(body.folderIds);
      if (update.folderIds.length > MAX_FOLDER_PICK) {
        return NextResponse.json({ error: `Choose at most ${MAX_FOLDER_PICK} folders.` }, { status: 400 });
      }
    }
    if (!Object.keys(update).length) {
      return NextResponse.json({ error: 'Nothing to change.' }, { status: 400 });
    }

    const profile = await updateProfile(id, update);
    return NextResponse.json({ profile });
  } catch (err) {
    return manageErrorResponse(err, 'save that GoLogin profile');
  }
});

/** DELETE — refused while anyone has the profile open. Restorable; see `/restore`. */
export const DELETE = withAuth<Params>(async (_req: NextRequest, token: DecodedIdToken, params) => {
  const denied = await requireGoLoginAccessAnd(token, 'profiles');
  if (denied) return denied;
  const { id } = await params;
  if (!isGoLoginId(id)) return NextResponse.json({ error: 'Unknown profile.' }, { status: 400 });

  try {
    await deleteProfile(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return manageErrorResponse(err, 'delete that GoLogin profile');
  }
});
