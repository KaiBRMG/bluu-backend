import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { adminDb } from '@/lib/firebase-admin';
import { getUserById, invalidateUserCache } from '@/lib/services/userService';
import { recomputeUserPermissions } from '@/lib/services/pageService';
import { FieldValue } from 'firebase-admin/firestore';
import type { DecodedIdToken } from 'firebase-admin/auth';

/**
 * POST /api/admin/groups/[groupId]/members
 * Add one or more users to a group. Updates both collections atomically.
 * Body: { uids: string[] }
 */
export const POST = withAuth(async (
  request: NextRequest,
  token: DecodedIdToken,
  params: Promise<{ groupId: string }>
) => {
  try {
    const caller = await getUserById(token.uid);
    if (!caller?.groups?.includes('admin')) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const { groupId } = await params;
    const { uids } = await request.json();

    if (!Array.isArray(uids) || uids.length === 0) {
      return NextResponse.json({ error: 'uids array is required' }, { status: 400 });
    }

    const batch = adminDb.batch();

    // Add each uid to the group's members array
    const groupRef = adminDb.collection('groups').doc(groupId);
    batch.update(groupRef, {
      members: FieldValue.arrayUnion(...uids),
    });

    // Add the groupId to each user's groups array
    for (const uid of uids) {
      const userRef = adminDb.collection('users').doc(uid);
      batch.update(userRef, {
        groups: FieldValue.arrayUnion(groupId),
      });
    }

    await batch.commit();
    // Invalidate in-process cache for all modified users
    for (const uid of uids) invalidateUserCache(uid);

    // Recompute permittedPageIds for each affected user (non-blocking).
    // Batch-read all user docs in one round-trip instead of N sequential reads.
    Promise.all(
      uids.map(uid => adminDb.collection('users').doc(uid))
    ).then(refs =>
      adminDb.getAll(...refs)
    ).then(snaps =>
      Promise.all(snaps.map(snap => {
        if (!snap.exists) return;
        const userGroups: string[] = snap.data()?.groups ?? [];
        return recomputeUserPermissions(snap.id, userGroups);
      }))
    ).catch(err => console.error('[GroupMembers POST] Failed to recompute permissions:', err));

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error('Error adding group members:', error);
    return NextResponse.json({ error: 'Failed to add members' }, { status: 500 });
  }
});

/**
 * DELETE /api/admin/groups/[groupId]/members
 * Remove a user from a group. Updates both collections atomically.
 * Body: { uid: string }
 */
export const DELETE = withAuth(async (
  request: NextRequest,
  token: DecodedIdToken,
  params: Promise<{ groupId: string }>
) => {
  try {
    const caller = await getUserById(token.uid);
    if (!caller?.groups?.includes('admin')) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const { groupId } = await params;
    const { uid } = await request.json();

    if (!uid) {
      return NextResponse.json({ error: 'uid is required' }, { status: 400 });
    }

    const batch = adminDb.batch();

    // Remove uid from group's members array
    const groupRef = adminDb.collection('groups').doc(groupId);
    batch.update(groupRef, {
      members: FieldValue.arrayRemove(uid),
    });

    // Remove groupId from user's groups array
    const userRef = adminDb.collection('users').doc(uid);
    batch.update(userRef, {
      groups: FieldValue.arrayRemove(groupId),
    });

    await batch.commit();
    invalidateUserCache(uid);

    // Recompute permittedPageIds for the removed user (non-blocking)
    // Fetch the updated groups from the user doc after batch commit
    adminDb.collection('users').doc(uid).get().then(snap => {
      const userGroups: string[] = snap.data()?.groups ?? [];
      return recomputeUserPermissions(uid, userGroups);
    }).catch(err => console.error('[GroupMembers DELETE] Failed to recompute permissions:', err));

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error('Error removing group member:', error);
    return NextResponse.json({ error: 'Failed to remove member' }, { status: 500 });
  }
});
