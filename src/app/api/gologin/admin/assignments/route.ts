import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { adminDb } from '@/lib/firebase-admin';
import {
  changeAssignment,
  changeAssignmentFromFolder,
  getAssignmentOverview,
  goLoginErrorResponse,
  listGoLoginProfilesForMaster,
  requireGoLoginAccess,
  requireGoLoginAdmin,
} from '@/lib/services/gologinService';
import {
  GOLOGIN_ACCOUNTS_COLLECTION,
  type GoLoginAccountDoc,
} from '@/lib/services/gologinAccountService';
import type { DecodedIdToken } from 'firebase-admin/auth';

/**
 * Admin assignment — who can see which profiles.
 *
 * **Tier 3 (admin), not the `apps-gologin` page permission.** This route grants
 * and revokes access to live logged-in accounts, so it sits with the other
 * auth-graph routes under CLAUDE.md rule 3: holding the GoLogin page lets you
 * *use* profiles, not hand them out. `requireGoLoginAdmin` takes the JWT claim
 * as a fast path and falls back to the `admin` group — see its header for why a
 * bare claim check is not enough in a renderer that never reloads.
 *
 * Assignment is folder membership and nothing else — see
 * `gologinAccountService.ts` for why the share itself is created once and never
 * touched. Nothing is mirrored into Firestore, so the folder tree read here is
 * the single source of truth and cannot drift.
 */
export const maxDuration = 60;

/**
 * GET — everything the Management panel renders: linked operators with their
 * current profile membership, the master's whole profile list for the picker,
 * and the plan's share budget.
 *
 * Two provider requests at most (`GET /user`, plus the memoised profile walk),
 * both already cached for 60s.
 */
export const GET = withAuth(async (req: NextRequest, token: DecodedIdToken) => {
  const denied = (await requireGoLoginAccess(token.uid)) ?? (await requireGoLoginAdmin(token));
  if (denied) return denied;

  const force = req.nextUrl.searchParams.get('refresh') === '1';

  try {
    const [overview, master, accountsSnap] = await Promise.all([
      getAssignmentOverview(force),
      listGoLoginProfilesForMaster(force),
      adminDb.collection(GOLOGIN_ACCOUNTS_COLLECTION).get(),
    ]);

    const accounts = accountsSnap.docs.map((d) => d.data() as GoLoginAccountDoc);
    const folderById = new Map(overview.folders.map((f) => [f.id, f]));

    // One batched read for the names, never a lookup per operator (rule 9).
    const userDocs = accounts.length
      ? await adminDb.getAll(...accounts.map((a) => adminDb.collection('users').doc(a.uid)))
      : [];
    const userByUid = new Map(
      userDocs
        .filter((d) => d.exists)
        .map((d) => [d.id, d.data() as { displayName?: string; workEmail?: string; isArchived?: boolean }]),
    );

    const users = accounts
      .map((account) => {
        const folder = folderById.get(account.folderId);
        const user = userByUid.get(account.uid);
        return {
          uid: account.uid,
          displayName: user?.displayName ?? account.uid,
          workEmail: user?.workEmail ?? '',
          isArchived: user?.isArchived === true,
          glEmail: account.glEmail,
          folderId: account.folderId,
          // The folder's live name, not the stored one — it can be renamed in
          // GoLogin's dashboard, and the panel should show what is really there.
          folderName: folder?.name ?? account.folderName,
          /** Missing means the folder was deleted in GoLogin — surfaced, not hidden. */
          folderMissing: !folder,
          profileIds: folder?.profileIds ?? [],
        };
      })
      .sort((a, b) => a.displayName.localeCompare(b.displayName));

    // "1 share = 1 instance of a shared profile", per GoLogin's own metering.
    const sharesUsed = users.reduce((sum, u) => sum + u.profileIds.length, 0);

    // Source folders — the workspace's own grouping (REPOST, JORGE, …), which is
    // what an admin actually thinks in. Operators' personal folders are excluded:
    // they are the *destination* of an assignment, so offering one as a source
    // would let an admin copy one person's whole caseload onto another by
    // clicking a row that looks like any other.
    const operatorFolderIds = new Set(accounts.map((a) => a.folderId));
    const folders = overview.folders
      .filter((f) => !operatorFolderIds.has(f.id))
      .map((f) => ({ id: f.id, name: f.name, profileIds: f.profileIds }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return NextResponse.json({
      users,
      folders,
      profiles: master.profiles.map((p) => ({
        id: p.id,
        name: p.name,
        os: p.os,
        folders: p.folders,
        notes: p.notes,
      })),
      truncated: master.truncated,
      budget: { used: sharesUsed, max: overview.maxShares, planName: overview.planName },
      fetchedAtMs: master.fetchedAtMs,
    });
  } catch (err) {
    return goLoginErrorResponse(err, 'load profile assignments');
  }
});

/** How many profiles may move in one call. A bound, not a guess about intent. */
const MAX_BATCH = 200;

/**
 * POST — add or remove profiles from one operator's folder.
 *
 * Two shapes, both `{ uid, action: 'add' | 'remove' }` plus either:
 *   • `profileIds: string[]` — a hand-picked selection, capped at MAX_BATCH.
 *   • `sourceFolderId: string` — every profile currently in that source folder,
 *     expanded server-side. See `changeAssignmentFromFolder`: it is a **copy at
 *     this moment**, not a standing subscription to the folder.
 *
 * One provider request either way, plus a folder-name resolution normally served
 * from the 60s memo.
 */
export const POST = withAuth(async (req: NextRequest, token: DecodedIdToken) => {
  const denied = (await requireGoLoginAccess(token.uid)) ?? (await requireGoLoginAdmin(token));
  if (denied) return denied;

  let body: { uid?: unknown; profileIds?: unknown; action?: unknown; sourceFolderId?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body.' }, { status: 400 });
  }

  const uid = String(body.uid ?? '').trim();
  const action = String(body.action ?? '');
  const sourceFolderId = String(body.sourceFolderId ?? '').trim();
  const profileIds = Array.isArray(body.profileIds)
    ? body.profileIds.filter((id): id is string => typeof id === 'string')
    : [];

  if (!uid) return NextResponse.json({ error: 'Which user?' }, { status: 400 });
  if (action !== 'add' && action !== 'remove') {
    return NextResponse.json({ error: 'Action must be add or remove.' }, { status: 400 });
  }

  try {
    // A whole source folder. The server expands it from the memoised folder
    // tree, so a 90-profile folder is one request and never meets the batch cap
    // below — that cap bounds hand-picked selections, not a folder that is
    // legitimately large.
    if (sourceFolderId) {
      const { moved } = await changeAssignmentFromFolder({ uid, sourceFolderId, action });
      return NextResponse.json({ ok: true, moved });
    }

    if (!profileIds.length) {
      return NextResponse.json({ error: 'No profiles selected.' }, { status: 400 });
    }
    if (profileIds.length > MAX_BATCH) {
      return NextResponse.json(
        { error: `Too many profiles at once (max ${MAX_BATCH}).` },
        { status: 400 },
      );
    }

    await changeAssignment({ uid, profileIds, action });
    return NextResponse.json({ ok: true, moved: profileIds.length });
  } catch (err) {
    return goLoginErrorResponse(err, 'change that profile assignment');
  }
});
