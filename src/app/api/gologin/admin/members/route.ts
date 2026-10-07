import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { adminDb } from '@/lib/firebase-admin';
import { normalizeEmail } from '@/lib/authEmail';
import {
  goLoginErrorResponse,
  requireGoLoginAccessAnd,
} from '@/lib/services/gologinService';
import {
  addGoLoginMember,
  findMember,
  getMasterAccount,
  getWorkspace,
  GOLOGIN_ACCOUNTS_COLLECTION,
  GOLOGIN_PAGE_ID,
  GoLoginLinkError,
  usesMasterGoLoginToken,
  reconcileGoLoginMembers,
  removeGoLoginMember,
  shareGoLoginPage,
  unshareGoLoginPage,
  type GoLoginAccountDoc,
} from '@/lib/services/gologinAccountService';
import { getPagePermission } from '@/lib/services/pageService';
import { resolvePagePermission } from '@/lib/services/permissionResolver';
import { GOLOGIN_CAPABILITIES, type GoLoginCapability } from '@/lib/gologin/types';
import type { DecodedIdToken } from 'firebase-admin/auth';

/**
 * Workspace membership — who holds a **paid GoLogin seat**.
 *
 * This is the gate on the whole feature, not a convenience: a free GoLogin
 * account cannot generate an API token, so someone without a seat cannot use
 * GoLogin through Bluu no matter what page permissions they hold. Granting a
 * seat also creates their folder and scopes them to it, in one call — see
 * `addGoLoginMember`.
 *
 * **Gated on `apps-gologin` *plus* the Add & Remove Members capability
 * (`apps-gologin-members`), or admin** — this spends money and grants access to
 * live logged-in accounts, so the GoLogin page on its own is never enough. It
 * was the single `apps-gologin-management` grant until 2026-09-30; that is now
 * four separately grantable capabilities on `/admin-portal/sharing`. Admins
 * remain in unconditionally — see `requireGoLoginCapability`.
 *
 * **The page follows the seat** (2026-10-05). Granting a seat shares
 * `apps-gologin` with that person directly — the page only, never a capability —
 * and removing one revokes their direct grants on the page *and* all four
 * capabilities. This is a narrow, deliberate exception to "page-permission
 * writes need the admin claim": the write is pinned to one page id and one uid,
 * the seat being changed, and cannot be pointed at anything else. Unsharing on
 * the Sharing page never releases a seat; offboarding a user on the registry
 * does (`releaseGoLoginSeat`, from `/api/admin/users/[uid]`). GET reports each
 * member's Bluu and page status, so a seat nobody can use — page unshared, or a
 * release that failed — is visible here.
 *
 * Note this route does **not** call `requireGoLoginMember` on the caller. A
 * manager must be able to add the *first* member, including themselves, from a
 * workspace where nobody is set up yet.
 */
export const maxDuration = 120;

/** Where the person stands in Bluu — `userStage`'s vocabulary plus `deleted`. */
type BluuStatus = 'active' | 'invited' | 'no-access' | 'archived' | 'deleted';

interface UserFields {
  displayName?: string;
  workEmail?: string;
  isArchived?: boolean;
  isActive?: boolean;
  lastLoginAt?: unknown;
  hasCompletedOnboarding?: boolean;
  groups?: string[];
  permittedPageIds?: string[];
}

/** Same precedence as `userStage` in the registry: archived → invited → no access. */
function bluuStatus(user: UserFields | undefined): BluuStatus {
  if (!user) return 'deleted';
  if (user.isArchived) return 'archived';
  if (!user.lastLoginAt || user.hasCompletedOnboarding === false) return 'invited';
  if (user.isActive === false) return 'no-access';
  return 'active';
}

const CAPABILITY_ENTRIES = Object.entries(GOLOGIN_CAPABILITIES) as [GoLoginCapability, string][];

/**
 * GET — the member list, joined to Bluu users, plus the seat budget and any
 * GoLogin members that no Bluu user has been mapped to.
 *
 * One provider request (`GET /workspaces/{wid}`, memoised 60s) plus three
 * Firestore reads, and a `getAll` of only the groups that grant the page.
 */
export const GET = withAuth(async (req: NextRequest, token: DecodedIdToken) => {
  const denied = await requireGoLoginAccessAnd(token, 'members');
  if (denied) return denied;

  const force = req.nextUrl.searchParams.get('refresh') === '1';

  try {
    const [workspace, master, accountsSnap, usersSnap, pagePerm] = await Promise.all([
      getWorkspace(force),
      getMasterAccount(force),
      adminDb.collection(GOLOGIN_ACCOUNTS_COLLECTION).get(),
      adminDb.collection('users').get(),
      getPagePermission(GOLOGIN_PAGE_ID),
    ]);

    const accounts = accountsSnap.docs.map((d) => d.data() as GoLoginAccountDoc);
    const claimed = new Set(accounts.map((a) => normalizeEmail(a.glEmail)).filter(Boolean));
    const usersById = new Map(usersSnap.docs.map((d) => [d.id, d.data() as UserFields]));

    // `permittedPageIds` is what `checkPageAccess` actually enforces, so it
    // decides *whether*; the permission doc only explains *how*.
    const pageAccessOf = (uid: string, user: UserFields | undefined) => {
      if (!user?.permittedPageIds?.includes(GOLOGIN_PAGE_ID)) return { access: 'none' as const };
      const via = resolvePagePermission(pagePerm ?? undefined, uid, user.groups ?? []);
      return via?.via === 'group' && via.groupId
        ? { access: 'group' as const, groupId: via.groupId }
        : { access: 'direct' as const };
    };
    const pageAccess = new Map(accounts.map((a) => [a.uid, pageAccessOf(a.uid, usersById.get(a.uid))]));

    const groupIds = [...new Set([...pageAccess.values()].flatMap((p) => ('groupId' in p ? [p.groupId] : [])))];
    const groupSnaps = groupIds.length
      ? await adminDb.getAll(...groupIds.map((id) => adminDb.collection('groups').doc(id)))
      : [];
    const groupNames = new Map(groupSnaps.map((g) => [g.id, (g.data()?.name as string | undefined) ?? g.id]));

    const members = accounts.map((account) => {
      const member = findMember(workspace, account.glEmail);
      const user = usersById.get(account.uid);
      const page = pageAccess.get(account.uid)!;
      return {
        uid: account.uid,
        // Empty only when the Bluu account is gone — the panel renders that as "Deleted user".
        displayName: user ? user.displayName || user.workEmail || account.uid : '',
        workEmail: user?.workEmail ?? '',
        bluu: bluuStatus(user),
        /** Promoted to admin since the seat was granted — they now run on the master token. */
        isAdmin: usesMasterGoLoginToken(user),
        page: {
          access: page.access,
          groupName: 'groupId' in page ? groupNames.get(page.groupId) ?? page.groupId : null,
        },
        capabilities: CAPABILITY_ENTRIES
          .filter(([, pageId]) => user?.permittedPageIds?.includes(pageId))
          .map(([cap]) => cap),
        glEmail: account.glEmail,
        folderName: account.folderName,
        linked: !!account.tokenCipher,
        /** False while GoLogin's invitation is outstanding — they cannot mint a token yet. */
        joined: member?.joined === true,
        /** True when the seat is gone from GoLogin's side. Surfaced, not hidden. */
        seatMissing: !member,
        memberAddedAtMs: account.memberAddedAtMs ?? null,
      };
    });
    // Deleted users (no name left) sort last rather than first.
    members.sort((a, b) => (a.displayName || '\uffff').localeCompare(b.displayName || '\uffff'));

    // Bluu users who could be given a seat: not archived, not already holding
    // one, and **not an admin** — admins operate on the master token, so a seat
    // would burn money to grant them a narrower view of a workspace they
    // already administer.
    const candidates = usersSnap.docs
      .map((d) => ({ uid: d.id, ...(d.data() as UserFields) }))
      .filter((u) => !u.isArchived && !usesMasterGoLoginToken(u) && !accounts.some((a) => a.uid === u.uid))
      .map((u) => ({ uid: u.uid, displayName: u.displayName ?? u.uid, workEmail: u.workEmail ?? '' }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName));

    // Seats GoLogin knows about that Bluu does not — the pre-existing workspace.
    // Reported rather than guessed at: binding the wrong Bluu user to a seat
    // would show one person another person's profiles.
    //
    // The owner's own service account is excluded. It is not an operator, it
    // owns every profile already, and listing it would invite an admin to map a
    // shared service address to some individual.
    const masterKey = normalizeEmail(master.email);
    const unmapped = workspace.members
      .filter((m) => {
        const key = normalizeEmail(m.email);
        return !!key && key !== masterKey && !claimed.has(key);
      })
      .map((m) => ({ memberId: m.id, email: m.email, joined: m.joined, role: m.role }));

    return NextResponse.json({
      members,
      candidates,
      unmapped,
      seats: { used: workspace.members.length, max: workspace.maxMembers, planName: workspace.planName },
      workspaceName: workspace.name,
    });
  } catch (err) {
    return goLoginErrorResponse(err, 'load the GoLogin member list');
  }
});

/**
 * POST — grant a seat (`{ uid, email }`), reconcile a pre-existing workspace
 * (`{ action: 'reconcile' }`), or re-share the page with an existing seat holder
 * (`{ action: 'share-page', uid }`).
 *
 * Both ways of gaining a seat also share `apps-gologin` with the person. That
 * share is **best-effort after the seat**: the seat is the paid, provider-side
 * half and has already happened, so a failed Firestore write is reported as
 * `pageShared: false` (the panel offers *Share page*) rather than as a failed add.
 *
 * Reconciliation exists because the workspace was in use before this feature:
 * those members hold seats but have no Bluu folder and no row here. It matches
 * on `workEmail`, provisions what it can, and reports the rest for an admin to
 * map by hand.
 */
export const POST = withAuth(async (req: NextRequest, token: DecodedIdToken) => {
  const denied = await requireGoLoginAccessAnd(token, 'members');
  if (denied) return denied;

  let body: { uid?: unknown; email?: unknown; action?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body.' }, { status: 400 });
  }

  try {
    const action = String(body.action ?? '');
    if (action === 'reconcile') {
      const result = await reconcileGoLoginMembers(token.uid);
      const pageShared = await shareGoLoginPage(result.provisioned.map((p) => p.uid))
        .then(() => true)
        .catch((err) => {
          console.error('[gologin] reconcile: sharing the page failed', err);
          return false;
        });
      return NextResponse.json({ ...result, pageShared });
    }

    const uid = String(body.uid ?? '').trim();

    if (action === 'share-page') {
      // Only for someone who holds a seat — this route is not a general way to
      // hand out `apps-gologin`, and the seat row is what makes it this one's call.
      if (!uid) return NextResponse.json({ error: 'Which user?' }, { status: 400 });
      const [seat, user] = await Promise.all([
        adminDb.collection(GOLOGIN_ACCOUNTS_COLLECTION).doc(uid).get(),
        adminDb.collection('users').doc(uid).get(),
      ]);
      if (!seat.exists) {
        return NextResponse.json({ error: 'That person does not hold a GoLogin seat.' }, { status: 404 });
      }
      if (!user.exists) {
        return NextResponse.json({ error: 'That user has been deleted from Bluu.' }, { status: 404 });
      }
      await shareGoLoginPage([uid]);
      return NextResponse.json({ ok: true });
    }

    const email = String(body.email ?? '').trim();
    if (!uid) return NextResponse.json({ error: 'Which user?' }, { status: 400 });
    if (!normalizeEmail(email)) {
      return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 });
    }

    const userSnap = await adminDb.collection('users').doc(uid).get();
    if (!userSnap.exists) {
      return NextResponse.json({ error: 'That user does not exist.' }, { status: 404 });
    }

    const account = await addGoLoginMember({ uid, email, addedByUid: token.uid });
    const pageShared = await shareGoLoginPage([uid])
      .then(() => true)
      .catch((err) => {
        console.error('[gologin] seat granted but sharing the page failed', uid, err);
        return false;
      });
    return NextResponse.json({ ok: true, glEmail: account.glEmail, folderName: account.folderName, pageShared });
  } catch (err) {
    if (err instanceof GoLoginLinkError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    return goLoginErrorResponse(err, 'add that member to the GoLogin workspace');
  }
});

/**
 * DELETE — revoke a seat (`?uid=`).
 *
 * Removes them from the GoLogin workspace and forgets their row, which stops
 * every Bluu route immediately. **Their folder is deliberately kept**: it holds
 * the assignment record for profiles that still exist, and re-adding the person
 * adopts it again, so a mistaken removal is fully reversible.
 *
 * Then revokes their **direct** grants on `apps-gologin` and all four
 * capabilities. Access through a group cannot be removed per person, so it is
 * returned as `stillSharedVia` (a group name) for the panel to say so.
 */
export const DELETE = withAuth(async (req: NextRequest, token: DecodedIdToken) => {
  const denied = await requireGoLoginAccessAnd(token, 'members');
  if (denied) return denied;

  const uid = req.nextUrl.searchParams.get('uid')?.trim();
  if (!uid) return NextResponse.json({ error: 'Which user?' }, { status: 400 });

  try {
    await removeGoLoginMember(uid);
    try {
      const stillSharedVia = await unshareGoLoginPage(uid);
      return NextResponse.json({ ok: true, pageRevoked: true, stillSharedVia });
    } catch (err) {
      // The seat — the paid half, and the one that actually cuts access — is
      // gone either way. Say the page part failed rather than fail the removal.
      console.error('[gologin] seat removed but revoking the page failed', uid, err);
      return NextResponse.json({ ok: true, pageRevoked: false, stillSharedVia: null });
    }
  } catch (err) {
    // Refusing to remove the workspace owner is a 409 with a reason, not a 500.
    if (err instanceof GoLoginLinkError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    return goLoginErrorResponse(err, 'remove that member from the GoLogin workspace');
  }
});
