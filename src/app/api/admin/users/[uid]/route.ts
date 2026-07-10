import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { adminDb, adminStorage, adminAuth } from '@/lib/firebase-admin';
import { getUserById, invalidateUserCache } from '@/lib/services/userService';
import { invalidateAdminUsersCache } from '@/app/api/admin/users/route';
import { invalidateDisplayNamesCache } from '@/app/api/users/display-names/route';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { randomUUID } from 'crypto';
import type { DecodedIdToken } from 'firebase-admin/auth';

/**
 * PUT /api/admin/users/[uid]
 * Admin-only. Updates any user's profile fields.
 * Does NOT handle group membership — use /api/admin/groups/[groupId]/members for that.
 */
export const PUT = withAuth(async (
  request: NextRequest,
  token: DecodedIdToken,
  params: Promise<{ uid: string }>
) => {
  try {
    const caller = await getUserById(token.uid);
    if (!caller?.permittedPageIds?.includes('user-management')) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const { uid: targetUid } = await params;
    const updates = await request.json();

    const effectiveFields = [
      'firstName',
      'lastName',
      'displayName',
      'gender',
      'DOB',
      'jobTitle',
      'employmentType',
      'address',
      'contactInfo',
      'paymentMethod',
      'paymentInfo',
      'userComments',
      'photoURL',
      'enableIdleTimeout',
      'enableScreenshots',
      'hasPaidLeave',
      'remainingUnpaidLeave',
      'remainingPaidLeave',
      'isActive',
      'isArchived',
    ];

    // Filter and sanitize updates
    const sanitizedUpdates: Record<string, unknown> = {};

    for (const field of effectiveFields) {
      if (updates[field] !== undefined) {
        if (field === 'DOB' && updates[field]) {
          sanitizedUpdates[field] = Timestamp.fromDate(new Date(updates[field]));
        } else if (field === 'DOB' && !updates[field]) {
          sanitizedUpdates[field] = null;
        } else {
          sanitizedUpdates[field] = updates[field];
        }
      }
    }

    if (Object.keys(sanitizedUpdates).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
    }

    // Rotating sessionToken forces an immediate sign-out via the onSnapshot
    // mismatch check in useUserData — required when deactivating an account.
    if (sanitizedUpdates.isActive === false) {
      sanitizedUpdates.sessionToken = randomUUID();
    }

    const userRef = adminDb.collection('users').doc(targetUid);
    await userRef.update({
      ...sanitizedUpdates,
      updatedAt: FieldValue.serverTimestamp(),
    });
    invalidateUserCache(targetUid);
    invalidateAdminUsersCache();
    invalidateDisplayNamesCache();

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error('Error updating user:', error);
    return NextResponse.json({ error: 'Failed to update user' }, { status: 500 });
  }
});

/**
 * Delete every document returned by a query, chunked into batches of 500
 * (Firestore's per-batch write limit). Returns the number of docs deleted.
 */
async function deleteQueryDocs(query: FirebaseFirestore.Query): Promise<number> {
  const snap = await query.get();
  if (snap.empty) return 0;

  const refs = snap.docs.map(d => d.ref);
  for (let i = 0; i < refs.length; i += 500) {
    const batch = adminDb.batch();
    refs.slice(i, i + 500).forEach(ref => batch.delete(ref));
    await batch.commit();
  }
  return refs.length;
}

/**
 * DELETE /api/admin/users/[uid]
 * Admin-only. Permanently deletes a user and ALL of their personal data:
 * the user document, group membership, page permissions, active session,
 * time entries (timesheets), screenshots (Firestore docs + Storage files),
 * shifts, leave requests, notifications, bug reports, and profile photo.
 *
 * Shared business records (disputes, campaign-tracking, content-planning,
 * notification batches) reference the user only as a participant/audit field
 * and belong to creators or other employees, so they are intentionally kept.
 */
export const DELETE = withAuth(async (
  _request: NextRequest,
  token: DecodedIdToken,
  params: Promise<{ uid: string }>
) => {
  try {
    const caller = await getUserById(token.uid);
    if (!caller?.permittedPageIds?.includes('user-management')) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const { uid: targetUid } = await params;

    if (targetUid === token.uid) {
      return NextResponse.json({ error: 'Cannot delete your own account' }, { status: 400 });
    }

    // ─── 1. User doc, group membership, page permissions ────────────────
    const membershipBatch = adminDb.batch();

    membershipBatch.delete(adminDb.collection('users').doc(targetUid));

    const groupsSnap = await adminDb.collection('groups').get();
    for (const groupDoc of groupsSnap.docs) {
      const members: string[] = groupDoc.data().members || [];
      if (members.includes(targetUid)) {
        membershipBatch.update(groupDoc.ref, { members: FieldValue.arrayRemove(targetUid) });
      }
    }

    const pagePermsSnap = await adminDb.collection('page-permissions').get();
    for (const permDoc of pagePermsSnap.docs) {
      const users = permDoc.data().users || {};
      if (users[targetUid]) {
        membershipBatch.update(permDoc.ref, { [`users.${targetUid}`]: FieldValue.delete() });
      }
    }

    // active_sessions is keyed by uid (at most one doc per user)
    membershipBatch.delete(adminDb.collection('active_sessions').doc(targetUid));

    await membershipBatch.commit();

    // ─── 2. Personal data collections (queried by the user's uid) ───────
    await Promise.all([
      deleteQueryDocs(adminDb.collection('time_entries').where('userId', '==', targetUid)),
      deleteQueryDocs(adminDb.collection('time-entries').where('userId', '==', targetUid)),
      deleteQueryDocs(adminDb.collection('screenshots').where('userId', '==', targetUid)),
      deleteQueryDocs(adminDb.collection('shifts').where('userId', '==', targetUid)),
      deleteQueryDocs(adminDb.collection('leave_requests').where('userId', '==', targetUid)),
      deleteQueryDocs(adminDb.collection('notifications').where('userId', '==', targetUid)),
      deleteQueryDocs(adminDb.collection('bugs').where('uid', '==', targetUid)),
    ]);

    // ─── 3. Storage: screenshots (full-size + thumbnails) and profile photo ──
    const bucket = adminStorage.bucket();
    await Promise.all([
      bucket.deleteFiles({ prefix: `screenshots/${targetUid}/` }).catch(err => {
        console.error(`[DeleteUser] Failed to delete screenshot storage for ${targetUid}:`, err);
      }),
      bucket.deleteFiles({ prefix: `profile-photos/${targetUid}/` }).catch(err => {
        console.error(`[DeleteUser] Failed to delete profile photo for ${targetUid}:`, err);
      }),
    ]);

    // ─── 4. Firebase Auth account ───────────────────────────────────────
    // Removing the Firestore doc without removing the Auth account leaves an
    // orphaned login: the user could sign in again, get the SAME uid back, and
    // silently recreate their doc ("resurrection"). Delete the Auth account too.
    // Tolerate user-not-found so the cascade stays idempotent.
    await adminAuth.deleteUser(targetUid).catch((err: { code?: string }) => {
      if (err?.code !== 'auth/user-not-found') {
        console.error(`[DeleteUser] Failed to delete Auth account for ${targetUid}:`, err);
      }
    });

    invalidateUserCache(targetUid);
    invalidateAdminUsersCache();
    invalidateDisplayNamesCache();

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error('Error deleting user:', error);
    return NextResponse.json({ error: 'Failed to delete user' }, { status: 500 });
  }
});
