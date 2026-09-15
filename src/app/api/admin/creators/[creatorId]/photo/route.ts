import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { adminDb } from '@/lib/firebase-admin';
import { getUserById } from '@/lib/services/userService';
import { FieldValue } from 'firebase-admin/firestore';
import {
  CreatorPhotoRejected,
  MAX_CREATOR_PHOTO_BYTES,
  storeCreatorPhoto,
} from '@/lib/services/creatorPhotoService';
import type { DecodedIdToken } from 'firebase-admin/auth';

/**
 * POST /api/admin/creators/[creatorId]/photo
 *
 * Accepts a base64 image and stores it as the creator's avatar.
 *
 * The encoding, validation, sizing and cache policy all live in
 * `creatorPhotoService` — this route is auth, payload shape, and the Firestore
 * write. Whatever is uploaded comes out the other side as a 256px WebP; see
 * that module for why.
 */

export const POST = withAuth(async (request: NextRequest, token: DecodedIdToken, params: Promise<{ creatorId: string }>) => {
  try {
    const caller = await getUserById(token.uid);
    if (!caller?.permittedPageIds?.includes('admin-creator-management')) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const { creatorId } = await params;
    const body = await request.json();
    const { imageData } = body as { imageData?: string };

    if (!imageData || typeof imageData !== 'string') {
      return NextResponse.json({ error: 'Missing imageData' }, { status: 400 });
    }

    // The client's `contentType` is deliberately ignored — `sharp` decides what
    // this is by decoding it. A base64 payload is ~4/3 the size of its bytes, so
    // the cheap length check happens before the (larger) allocation.
    const base64Data = imageData.replace(/^data:image\/[\w+.-]+;base64,/, '');
    if (base64Data.length > MAX_CREATOR_PHOTO_BYTES * 1.4) {
      return NextResponse.json({ error: 'That image is too large — keep it under 5MB.' }, { status: 413 });
    }

    const buffer = Buffer.from(base64Data, 'base64');

    const creatorRef = adminDb.collection('creators').doc(creatorId);
    const snap = await creatorRef.get();
    if (!snap.exists) {
      return NextResponse.json({ error: 'Creator not found' }, { status: 404 });
    }

    const { photoURL, photoStoragePath } = await storeCreatorPhoto(
      creatorId,
      buffer,
      token.uid,
      snap.data()?.photoStoragePath ?? null,
    );

    await creatorRef.update({ photoURL, photoStoragePath, updatedAt: FieldValue.serverTimestamp() });

    return NextResponse.json({ success: true, photoURL });
  } catch (error: unknown) {
    // A rejection is the admin's problem to fix (wrong file, too big), so its
    // message goes back verbatim rather than becoming a generic 500.
    if (error instanceof CreatorPhotoRejected) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error('[POST /api/admin/creators/[creatorId]/photo]', error);
    return NextResponse.json({ error: 'Failed to upload photo' }, { status: 500 });
  }
});
