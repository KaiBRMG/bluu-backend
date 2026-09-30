import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { readJsonBody } from '@/lib/middleware/apiHelpers';
import { isGoLoginOsChoice } from '@/lib/gologin';
import { requireGoLoginAccessAnd } from '@/lib/services/gologinService';
import {
  cleanProfileName,
  createProfile,
  manageErrorResponse,
  MAX_FOLDER_PICK,
  parseIdList,
  parseProxyInput,
} from '@/lib/services/gologinManageService';
import type { DecodedIdToken } from 'firebase-admin/auth';

/**
 * POST /api/gologin/manage/profiles — create a profile.
 *
 * Gated on `apps-gologin` plus the **Create, Edit & Delete Profiles** capability
 * (admins always). Body: `{ name, os, proxy: {...} | null, folderIds }`.
 *
 * Three to five provider requests: quick-create, attach (or explicitly clear)
 * the proxy, one per folder, and a read-back of the new row. A failed proxy
 * step deletes the profile rather than leaving it on the operator's real IP —
 * see `createProfile`.
 *
 * Not cacheable: a write.
 */
export const maxDuration = 60;

const MAX_BODY_BYTES = 8 * 1024;

export const POST = withAuth(async (req: NextRequest, token: DecodedIdToken) => {
  const denied = await requireGoLoginAccessAnd(token, 'profiles');
  if (denied) return denied;

  const parsed = await readJsonBody(req, MAX_BODY_BYTES);
  if (!parsed.ok) return parsed.response;
  const body = (parsed.body ?? {}) as Record<string, unknown>;

  try {
    const name = cleanProfileName(body.name);
    if (!isGoLoginOsChoice(body.os)) {
      return NextResponse.json({ error: 'Choose an operating system.' }, { status: 400 });
    }
    // `null` is the explicit "without proxy" choice; anything else must parse.
    const proxy = body.proxy === null ? null : parseProxyInput(body.proxy);
    const folderIds = parseIdList(body.folderIds);
    if (folderIds.length > MAX_FOLDER_PICK) {
      return NextResponse.json({ error: `Choose at most ${MAX_FOLDER_PICK} folders.` }, { status: 400 });
    }

    const result = await createProfile({ callerUid: token.uid, name, os: body.os, proxy, folderIds });
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    return manageErrorResponse(err, 'create that GoLogin profile');
  }
});
