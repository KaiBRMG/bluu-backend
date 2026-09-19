import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { adminDb } from '@/lib/firebase-admin';
import { normalizeEmail } from '@/lib/authEmail';
import {
  goLoginErrorResponse,
  requireGoLoginAccess,
  requireGoLoginManagement,
} from '@/lib/services/gologinService';
import {
  addGoLoginMember,
  findMember,
  getMasterAccount,
  getWorkspace,
  GOLOGIN_ACCOUNTS_COLLECTION,
  GoLoginLinkError,
  usesMasterGoLoginToken,
  reconcileGoLoginMembers,
  removeGoLoginMember,
  type GoLoginAccountDoc,
} from '@/lib/services/gologinAccountService';
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
 * **Gated on `apps-gologin` *plus* `apps-gologin-management`, or the admin
 * claim** — this spends money and grants access to live logged-in accounts, so
 * the GoLogin page on its own is never enough. The second gate was tier 3
 * outright until 2026-09-19; it is now the `apps-gologin-management` sub-item,
 * granted on `/admin-portal/sharing` under the GoLogin row. Admins remain in
 * unconditionally — see `requireGoLoginManagement`.
 *
 * Note this route does **not** call `requireGoLoginMember` on the caller. A
 * manager must be able to add the *first* member, including themselves, from a
 * workspace where nobody is set up yet.
 */
export const maxDuration = 120;

/**
 * GET — the member list, joined to Bluu users, plus the seat budget and any
 * GoLogin members that no Bluu user has been mapped to.
 *
 * One provider request (`GET /workspaces/{wid}`, memoised 60s) plus two
 * Firestore reads.
 */
export const GET = withAuth(async (req: NextRequest, token: DecodedIdToken) => {
  const denied = (await requireGoLoginAccess(token.uid)) ?? (await requireGoLoginManagement(token));
  if (denied) return denied;

  const force = req.nextUrl.searchParams.get('refresh') === '1';

  try {
    const [workspace, master, accountsSnap, usersSnap] = await Promise.all([
      getWorkspace(force),
      getMasterAccount(force),
      adminDb.collection(GOLOGIN_ACCOUNTS_COLLECTION).get(),
      adminDb.collection('users').get(),
    ]);

    const accounts = accountsSnap.docs.map((d) => d.data() as GoLoginAccountDoc);
    const claimed = new Set(accounts.map((a) => normalizeEmail(a.glEmail)).filter(Boolean));

    const members = accounts.map((account) => {
      const member = findMember(workspace, account.glEmail);
      const user = usersSnap.docs.find((d) => d.id === account.uid)?.data() as
        | { displayName?: string; workEmail?: string; isArchived?: boolean }
        | undefined;
      return {
        uid: account.uid,
        displayName: user?.displayName ?? account.uid,
        workEmail: user?.workEmail ?? '',
        isArchived: user?.isArchived === true,
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
    members.sort((a, b) => a.displayName.localeCompare(b.displayName));

    // Bluu users who could be given a seat: not archived, not already holding
    // one, and **not an admin** — admins operate on the master token, so a seat
    // would burn money to grant them a narrower view of a workspace they
    // already administer.
    const candidates = usersSnap.docs
      .map((d) => ({ uid: d.id, ...(d.data() as { displayName?: string; workEmail?: string; isArchived?: boolean; groups?: string[] }) }))
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
 * POST — grant a seat (`{ uid, email }`), or reconcile a pre-existing workspace
 * (`{ action: 'reconcile' }`).
 *
 * Reconciliation exists because the workspace was in use before this feature:
 * those members hold seats but have no Bluu folder and no row here. It matches
 * on `workEmail`, provisions what it can, and reports the rest for an admin to
 * map by hand.
 */
export const POST = withAuth(async (req: NextRequest, token: DecodedIdToken) => {
  const denied = (await requireGoLoginAccess(token.uid)) ?? (await requireGoLoginManagement(token));
  if (denied) return denied;

  let body: { uid?: unknown; email?: unknown; action?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body.' }, { status: 400 });
  }

  try {
    if (String(body.action ?? '') === 'reconcile') {
      const result = await reconcileGoLoginMembers(token.uid);
      return NextResponse.json(result);
    }

    const uid = String(body.uid ?? '').trim();
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
    return NextResponse.json({ ok: true, glEmail: account.glEmail, folderName: account.folderName });
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
 */
export const DELETE = withAuth(async (req: NextRequest, token: DecodedIdToken) => {
  const denied = (await requireGoLoginAccess(token.uid)) ?? (await requireGoLoginManagement(token));
  if (denied) return denied;

  const uid = req.nextUrl.searchParams.get('uid')?.trim();
  if (!uid) return NextResponse.json({ error: 'Which user?' }, { status: 400 });

  try {
    await removeGoLoginMember(uid);
    return NextResponse.json({ ok: true });
  } catch (err) {
    // Refusing to remove the workspace owner is a 409 with a reason, not a 500.
    if (err instanceof GoLoginLinkError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    return goLoginErrorResponse(err, 'remove that member from the GoLogin workspace');
  }
});
