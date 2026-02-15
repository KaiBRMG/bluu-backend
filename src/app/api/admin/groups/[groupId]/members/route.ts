import { NextRequest, NextResponse } from 'next/server';
import { adminDb, adminAuth } from '@/lib/firebase-admin';
import { getUserById } from '@/lib/services/userService';
import { FieldValue } from 'firebase-admin/firestore';

/**
 * POST /api/admin/groups/[groupId]/members
 * Add one or more users to a group. Updates both collections atomically.
 * Body: { uids: string[] }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ groupId: string }> }
) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Missing authorization token' }, { status: 401 });
    }

    const idToken = authHeader.split('Bearer ')[1];
    const decodedToken = await adminAuth.verifyIdToken(idToken);
    const callerUid = decodedToken.uid;

    const caller = await getUserById(callerUid);
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

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error('Error adding group members:', error);
    const errorCode = (error as { code?: string })?.code;
    if (errorCode === 'auth/id-token-expired') {
      return NextResponse.json({ error: 'Session expired' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Failed to add members' }, { status: 500 });
  }
}

/**
 * DELETE /api/admin/groups/[groupId]/members
 * Remove a user from a group. Updates both collections atomically.
 * Body: { uid: string }
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ groupId: string }> }
) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Missing authorization token' }, { status: 401 });
    }

    const idToken = authHeader.split('Bearer ')[1];
    const decodedToken = await adminAuth.verifyIdToken(idToken);
    const callerUid = decodedToken.uid;

    const caller = await getUserById(callerUid);
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

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error('Error removing group member:', error);
    const errorCode = (error as { code?: string })?.code;
    if (errorCode === 'auth/id-token-expired') {
      return NextResponse.json({ error: 'Session expired' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Failed to remove member' }, { status: 500 });
  }
}
