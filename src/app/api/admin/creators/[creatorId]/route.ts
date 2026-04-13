import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { adminAuth, adminDb, adminStorage } from '@/lib/firebase-admin';
import { getUserById } from '@/lib/services/userService';
import { FieldValue } from 'firebase-admin/firestore';
import type { DecodedIdToken } from 'firebase-admin/auth';

async function checkPermission(uid: string): Promise<boolean> {
  const caller = await getUserById(uid);
  return !!caller?.permittedPageIds?.includes('admin-creator-management');
}

const ALLOWED_UPDATE_FIELDS = ['stageName', 'OFID', 'isActive', 'isArchived'] as const;

/**
 * PUT /api/admin/creators/[creatorId]
 * Updates Firestore fields and optionally resets the Firebase Auth password.
 * Syncs disabled state to Firebase Auth on isActive changes.
 */
export const PUT = withAuth(async (request: NextRequest, token: DecodedIdToken, params: Promise<{ creatorId: string }>) => {
  try {
    if (!(await checkPermission(token.uid))) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const { creatorId } = await params;
    const body = await request.json();

    // Build whitelisted Firestore update
    const firestoreUpdate: Record<string, unknown> = {
      updatedAt: FieldValue.serverTimestamp(),
    };
    for (const field of ALLOWED_UPDATE_FIELDS) {
      if (field in body) {
        firestoreUpdate[field] = body[field];
        // Keep displayName in sync with stageName
        if (field === 'stageName') {
          firestoreUpdate['displayName'] = body[field];
        }
      }
    }

    // Build a single Auth update to avoid redundant sequential calls
    const authUpdate: { disabled?: boolean; password?: string } = {};
    if ('isActive' in body) authUpdate.disabled = !body.isActive;
    if (body.isArchived === true) authUpdate.disabled = true;
    if (body.newPassword) authUpdate.password = body.newPassword;

    await Promise.all([
      adminDb.collection('creators').doc(creatorId).update(firestoreUpdate),
      Object.keys(authUpdate).length > 0
        ? adminAuth.updateUser(creatorId, authUpdate)
        : Promise.resolve(),
    ]);

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error('[PUT /api/admin/creators/[creatorId]]', error);
    return NextResponse.json({ error: 'Failed to update creator' }, { status: 500 });
  }
});

/**
 * DELETE /api/admin/creators/[creatorId]
 * Deletes the Firestore doc, Firebase Auth user, and Storage photo.
 */
export const DELETE = withAuth(async (request: NextRequest, token: DecodedIdToken, params: Promise<{ creatorId: string }>) => {
  try {
    if (!(await checkPermission(token.uid))) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const { creatorId } = await params;

    // Read doc first to get storage path
    const docSnap = await adminDb.collection('creators').doc(creatorId).get();
    const photoStoragePath = docSnap.data()?.photoStoragePath ?? null;

    // Delete in parallel where possible
    await Promise.all([
      adminDb.collection('creators').doc(creatorId).delete(),
      adminAuth.deleteUser(creatorId),
      photoStoragePath
        ? adminStorage.bucket().file(photoStoragePath).delete().catch(() => null)
        : Promise.resolve(),
    ]);

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error('[DELETE /api/admin/creators/[creatorId]]', error);
    return NextResponse.json({ error: 'Failed to delete creator' }, { status: 500 });
  }
});
