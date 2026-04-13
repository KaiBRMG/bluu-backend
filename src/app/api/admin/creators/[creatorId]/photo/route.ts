import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { withAuth } from '@/lib/middleware/withAuth';
import { adminDb, adminStorage } from '@/lib/firebase-admin';
import { getUserById } from '@/lib/services/userService';
import { FieldValue } from 'firebase-admin/firestore';
import type { DecodedIdToken } from 'firebase-admin/auth';

const MAX_FILE_SIZE = 5 * 1024 * 1024;
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

/**
 * POST /api/admin/creators/[creatorId]/photo
 * Accepts base64 image, uploads to Storage, writes signed URL to Firestore.
 */
export const POST = withAuth(async (request: NextRequest, token: DecodedIdToken, params: Promise<{ creatorId: string }>) => {
  try {
    const caller = await getUserById(token.uid);
    if (!caller?.permittedPageIds?.includes('admin-creator-management')) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const { creatorId } = await params;
    const body = await request.json();
    const { imageData, contentType } = body;

    if (!imageData || !contentType) {
      return NextResponse.json({ error: 'Missing imageData or contentType' }, { status: 400 });
    }
    if (!ALLOWED_TYPES.includes(contentType)) {
      return NextResponse.json({ error: 'Invalid file type. Allowed: JPEG, PNG, GIF, WebP' }, { status: 400 });
    }

    const base64Data = imageData.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');

    if (buffer.length > MAX_FILE_SIZE) {
      return NextResponse.json({ error: 'File too large. Maximum size is 5MB' }, { status: 400 });
    }

    const ext = contentType.split('/')[1] === 'jpeg' ? 'jpg' : contentType.split('/')[1];
    const filePath = `creator-photos/${creatorId}/avatar.${ext}`;

    const bucket = adminStorage.bucket();
    const file = bucket.file(filePath);

    const downloadToken = randomUUID();
    await file.save(buffer, {
      metadata: {
        contentType,
        metadata: {
          firebaseStorageDownloadTokens: downloadToken,
          uploadedBy: token.uid,
          uploadedAt: new Date().toISOString(),
        },
      },
    });

    const bucketName = adminStorage.bucket().name;
    const photoURL = `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(filePath)}?alt=media&token=${downloadToken}`;

    await adminDb.collection('creators').doc(creatorId).update({
      photoURL,
      photoStoragePath: filePath,
      updatedAt: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({ success: true, photoURL });
  } catch (error: unknown) {
    console.error('[POST /api/admin/creators/[creatorId]/photo]', error);
    return NextResponse.json({ error: 'Failed to upload photo' }, { status: 500 });
  }
});
