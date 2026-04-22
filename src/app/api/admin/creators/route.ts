import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { adminAuth, adminDb } from '@/lib/firebase-admin';
import { getUserById } from '@/lib/services/userService';
import { FieldValue } from 'firebase-admin/firestore';
import type { DecodedIdToken } from 'firebase-admin/auth';

const CACHE_TTL_MS = 30_000;
let cache: { data: Record<string, unknown>[]; expiresAt: number } | null = null;

export function invalidateAdminCreatorsCache(): void {
  cache = null;
}

async function fetchCreators() {
  if (cache && Date.now() < cache.expiresAt) {
    return cache.data;
  }

  const snapshot = await adminDb.collection('creators').get();
  const creators = snapshot.docs.map(doc => {
    const data = doc.data();
    return {
      ...data,
      createdAt: data.createdAt?.toDate?.()?.toISOString() ?? null,
      updatedAt: data.updatedAt?.toDate?.()?.toISOString() ?? null,
    };
  });

  cache = { data: creators, expiresAt: Date.now() + CACHE_TTL_MS };
  return creators;
}

async function checkPermission(uid: string): Promise<boolean> {
  const caller = await getUserById(uid);
  return !!caller?.permittedPageIds?.includes('admin-creator-management');
}

/**
 * GET /api/admin/creators
 * Returns all creator documents from the creators collection.
 */
export const GET = withAuth(async (_request: NextRequest, token: DecodedIdToken) => {
  try {
    if (!(await checkPermission(token.uid))) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const creators = await fetchCreators();
    return NextResponse.json({ creators });
  } catch (error: unknown) {
    console.error('[GET /api/admin/creators]', error);
    return NextResponse.json({ error: 'Failed to fetch creators' }, { status: 500 });
  }
});

/**
 * POST /api/admin/creators
 * Creates a Firebase Auth user and a Firestore creator document.
 * Password is passed to Firebase Auth only — not stored in Firestore.
 */
export const POST = withAuth(async (request: NextRequest, token: DecodedIdToken) => {
  try {
    if (!(await checkPermission(token.uid))) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const body = await request.json();
    const { stageName, userEmail, password, OFID, driveLink = '', defaultTimezone = '' } = body;

    if (!stageName || !userEmail || !password || !OFID) {
      return NextResponse.json({ error: 'stageName, userEmail, password, and OFID are required' }, { status: 400 });
    }

    // Get or create the Firebase Auth user
    let uid: string;
    try {
      const authUser = await adminAuth.createUser({
        email: userEmail,
        password,
        displayName: stageName,
      });
      uid = authUser.uid;
    } catch (error: unknown) {
      const code = (error as { code?: string })?.code;
      if (code === 'auth/email-already-exists') {
        // Auth user exists (e.g. from prior testing) but no Firestore doc — reuse the UID.
        // Update displayName and password to match what the admin provided.
        const existing = await adminAuth.getUserByEmail(userEmail);
        uid = existing.uid;
        await adminAuth.updateUser(uid, { displayName: stageName, password, disabled: false });
      } else {
        throw error;
      }
    }

    // Ensure there's no existing creators doc for this UID
    const existingDoc = await adminDb.collection('creators').doc(uid).get();
    if (existingDoc.exists) {
      return NextResponse.json({ error: 'A creator with that email already exists' }, { status: 409 });
    }

    // Write Firestore doc
    await adminDb.collection('creators').doc(uid).set({
      uid,
      creatorID: uid,
      stageName,
      userEmail,
      displayName: stageName,
      photoURL: null,
      photoStoragePath: null,
      OFID,
      isActive: true,
      isArchived: false,
      driveLink: driveLink || '',
      defaultTimezone: defaultTimezone || '',
      lastCRID: 0,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    invalidateAdminCreatorsCache();
    return NextResponse.json({ success: true, uid });
  } catch (error: unknown) {
    console.error('[POST /api/admin/creators]', error);
    return NextResponse.json({ error: 'Failed to create creator' }, { status: 500 });
  }
});
