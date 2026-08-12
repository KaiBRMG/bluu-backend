import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { adminDb, adminAuth } from '@/lib/firebase-admin';
import {
  getUserById,
  invalidateUserCache,
  buildNewUserDoc,
  claimEmailInTransaction,
  addUserToGroup,
} from '@/lib/services/userService';
import { getAllGroups } from '@/lib/services/groupService';
import { recomputeUserPermissions } from '@/lib/services/pageService';
import { invalidateDisplayNamesCache } from '@/app/api/users/display-names/route';
import { normalizeEmail, isPlausibleEmail } from '@/lib/authEmail';
import type { DecodedIdToken } from 'firebase-admin/auth';

const CACHE_TTL_MS = 30_000;
let cache: { data: { users: Record<string, unknown>[]; groups: Record<string, unknown>[] }; expiresAt: number } | null = null;

export function invalidateAdminUsersCache(): void {
  cache = null;
}

function serializeTimestamps(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (v && typeof v === 'object' && typeof (v as { toDate?: unknown }).toDate === 'function') {
      out[k] = (v as { toDate(): Date }).toDate().toISOString();
    } else {
      out[k] = v;
    }
  }
  return out;
}

async function fetchUsersAndGroups() {
  if (cache && Date.now() < cache.expiresAt) {
    return cache.data;
  }

  const [usersSnapshot, groups] = await Promise.all([
    adminDb.collection('users').get(),
    getAllGroups(),
  ]);

  const users = usersSnapshot.docs.map(doc => serializeTimestamps(doc.data()));
  const serializedGroups = groups.map(g => serializeTimestamps(g as Record<string, unknown>));

  const data = { users, groups: serializedGroups };
  cache = { data, expiresAt: Date.now() + CACHE_TTL_MS };
  return data;
}

/**
 * GET /api/admin/users
 * Admin-only. Returns all users with full document data and all groups.
 */
export const GET = withAuth(async (request: NextRequest, token: DecodedIdToken) => {
  try {
    const caller = await getUserById(token.uid);
    if (!caller?.permittedPageIds?.includes('user-management')) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const data = await fetchUsersAndGroups();
    return NextResponse.json(data);
  } catch (error: unknown) {
    console.error('Error fetching admin users:', error);
    return NextResponse.json({ error: 'Failed to fetch users' }, { status: 500 });
  }
});

const MAX_NAME_LENGTH = 100;

/**
 * POST /api/admin/users
 *
 * Registers a new employee **before** their first login. This is the only way
 * an account comes into existence: login is an allowlist check against the docs
 * this route writes (`/api/auth/exchange-code`), and no longer provisions
 * anything itself.
 *
 * Authorisation is the `user-management` page permission — consistent with the
 * PUT and DELETE handlers on the same page. Note this is a deliberate widening:
 * anyone holding that page can now mint a login to the system. The one thing it
 * cannot do is create an admin, which still requires the admin claim — otherwise
 * the page permission would chain straight into full control of the auth graph
 * (same guard as /api/admin/groups/[groupId]/members).
 *
 * The user lands with `lastLoginAt: null` ("Invited") and walks the normal
 * onboarding flow the first time they sign in.
 */
export const POST = withAuth(async (request: NextRequest, token: DecodedIdToken) => {
  try {
    const caller = await getUserById(token.uid);
    if (!caller?.permittedPageIds?.includes('user-management')) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const body = await request.json();
    const firstName = String(body.firstName ?? '').trim();
    const lastName = String(body.lastName ?? '').trim();
    const displayName = String(body.displayName ?? '').trim();
    const email = String(body.email ?? '').trim();
    const groupId = String(body.groupId ?? '').trim() || 'unassigned';

    if (!firstName || !lastName || !displayName || !email) {
      return NextResponse.json(
        { error: 'First name, last name, nickname and email are all required' },
        { status: 400 },
      );
    }
    if (
      firstName.length > MAX_NAME_LENGTH ||
      lastName.length > MAX_NAME_LENGTH ||
      displayName.length > MAX_NAME_LENGTH
    ) {
      return NextResponse.json({ error: 'Name fields are too long' }, { status: 400 });
    }
    if (!isPlausibleEmail(email)) {
      return NextResponse.json({ error: 'Enter a valid email address' }, { status: 400 });
    }

    const emailKey = normalizeEmail(email);
    if (!emailKey) {
      return NextResponse.json({ error: 'Enter a valid email address' }, { status: 400 });
    }

    // Only existing admins may register someone directly into the admin group.
    if (groupId === 'admin' && token.admin !== true) {
      return NextResponse.json(
        { error: 'Only admins may add a user to the admin group' },
        { status: 403 },
      );
    }

    const groupSnap = await adminDb.collection('groups').doc(groupId).get();
    if (!groupSnap.exists) {
      return NextResponse.json({ error: `Unknown group: ${groupId}` }, { status: 400 });
    }

    // ─── Resolve the Firebase Auth account ──────────────────────────────
    // Normally a fresh one. Two collision cases matter, and they resolve
    // differently — an orphan is adoptable, a creator is not.
    let uid: string;
    try {
      const authUser = await adminAuth.createUser({
        email,
        displayName: `${firstName} ${lastName}`.trim(),
      });
      uid = authUser.uid;
    } catch (error: unknown) {
      if ((error as { code?: string })?.code !== 'auth/email-already-exists') throw error;

      const existing = await adminAuth.getUserByEmail(email);

      const [employeeDoc, creatorDoc] = await Promise.all([
        adminDb.collection('users').doc(existing.uid).get(),
        adminDb.collection('creators').doc(existing.uid).get(),
      ]);

      if (employeeDoc.exists) {
        return NextResponse.json(
          { error: 'An employee with that email already exists.' },
          { status: 409 },
        );
      }
      if (creatorDoc.exists) {
        // Creators sign in with email/password against the same Auth project.
        // Reusing the uid would give one identity both a users and a creators
        // doc — two auth contexts, one account. Never merge them.
        return NextResponse.json(
          { error: 'That email already belongs to a creator account. Use a different address.' },
          { status: 409 },
        );
      }

      // Orphaned Auth account (a previous delete that skipped the cascade, or
      // prior testing). Adopt it, exactly as the login flow used to.
      uid = existing.uid;
      await adminAuth.updateUser(uid, {
        email,
        displayName: `${firstName} ${lastName}`.trim(),
        disabled: false,
      });
    }

    // ─── Claim the email and write the doc atomically ───────────────────
    // The index doc is the lock: two admins registering the same address at the
    // same moment cannot both win, which a check-then-write would allow.
    try {
      await adminDb.runTransaction(async (tx) => {
        await claimEmailInTransaction(tx, { uid, email });
        tx.set(
          adminDb.collection('users').doc(uid),
          buildNewUserDoc({ uid, workEmail: email, firstName, lastName, displayName, groupId }),
        );
      });
    } catch (error: unknown) {
      if ((error as Error)?.message === 'EMAIL_TAKEN') {
        return NextResponse.json(
          { error: 'That email is already assigned to another user.' },
          { status: 409 },
        );
      }
      throw error;
    }

    // Group membership + permissions. After the doc exists, so a failure here
    // leaves a registered user with no pages rather than an orphaned claim.
    await addUserToGroup(uid, groupId);
    await recomputeUserPermissions(uid, [groupId]);

    invalidateUserCache(uid);
    invalidateAdminUsersCache();
    invalidateDisplayNamesCache();

    return NextResponse.json({ success: true, uid });
  } catch (error: unknown) {
    console.error('Error registering user:', error);
    return NextResponse.json({ error: 'Failed to register user' }, { status: 500 });
  }
});
