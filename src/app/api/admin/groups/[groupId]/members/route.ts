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
    if (!caller?.permittedPageIds?.includes('user-management')) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const { groupId } = await params;
    const { uids } = await request.json();

    if (!Array.isArray(uids) || uids.length === 0) {
      return NextResponse.json({ error: 'uids array is required' }, { status: 400 });
    }

    // Fetch current user docs to determine which are in 'unassigned'
    const userRefs = uids.map(uid => adminDb.collection('users').doc(uid));
    const userSnaps = await adminDb.getAll(...userRefs);
    const usersInUnassigned = new Set<string>();
    for (const snap of userSnaps) {
      if (snap.exists && (snap.data()?.groups ?? []).includes('unassigned')) {
        usersInUnassigned.add(snap.id);
      }
    }

    const batch = adminDb.batch();

    // Add each uid to the target group's members array
    const groupRef = adminDb.collection('groups').doc(groupId);
    batch.update(groupRef, {
      members: FieldValue.arrayUnion(...uids),
    });

    // For users currently in 'unassigned', remove them from it
    if (usersInUnassigned.size > 0) {
      const unassignedRef = adminDb.collection('groups').doc('unassigned');
      batch.update(unassignedRef, {
        members: FieldValue.arrayRemove(...Array.from(usersInUnassigned)),
      });
    }

    // Update each user's groups array: add new group, remove 'unassigned' if applicable
    for (const uid of uids) {
      const userRef = adminDb.collection('users').doc(uid);
      if (usersInUnassigned.has(uid)) {
        // arrayUnion + arrayRemove can't be combined on the same field in one update;
        // build the corrected array directly from the snapshot
        const currentGroups: string[] = userSnaps.find(s => s.id === uid)?.data()?.groups ?? [];
        const newGroups = [...new Set([...currentGroups.filter(g => g !== 'unassigned'), groupId])];
        batch.update(userRef, { groups: newGroups });
      } else {
        batch.update(userRef, { groups: FieldValue.arrayUnion(groupId) });
      }
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
    if (!caller?.permittedPageIds?.includes('user-management')) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const { groupId } = await params;
    const { uid } = await request.json();

    if (!uid) {
      return NextResponse.json({ error: 'uid is required' }, { status: 400 });
    }

    // Fetch current user doc to compute remaining groups after removal
    const userRef = adminDb.collection('users').doc(uid);
    const userSnap = await userRef.get();
    const currentGroups: string[] = userSnap.data()?.groups ?? [];
    const remainingGroups = currentGroups.filter(g => g !== groupId && g !== 'unassigned');
    const needsUnassigned = remainingGroups.length === 0;

    const batch = adminDb.batch();

    // Remove uid from the target group's members array
    const groupRef = adminDb.collection('groups').doc(groupId);
    batch.update(groupRef, { members: FieldValue.arrayRemove(uid) });

    // Update user's groups: remove the group, add 'unassigned' if now groupless
    batch.update(userRef, {
      groups: needsUnassigned ? ['unassigned'] : remainingGroups,
    });

    // If falling back to unassigned, add to that group's members array
    if (needsUnassigned) {
      const unassignedRef = adminDb.collection('groups').doc('unassigned');
      batch.update(unassignedRef, { members: FieldValue.arrayUnion(uid) });
    }

    await batch.commit();
    invalidateUserCache(uid);

    // Recompute permittedPageIds for the removed user (non-blocking)
    const updatedGroups = needsUnassigned ? ['unassigned'] : remainingGroups;
    recomputeUserPermissions(uid, updatedGroups)
      .catch(err => console.error('[GroupMembers DELETE] Failed to recompute permissions:', err));

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error('Error removing group member:', error);
    return NextResponse.json({ error: 'Failed to remove member' }, { status: 500 });
  }
});
