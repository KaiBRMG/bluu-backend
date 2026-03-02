import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { adminDb, adminStorage } from '@/lib/firebase-admin';
import { invalidateUserCache } from '@/lib/services/userService';
import { FieldValue } from 'firebase-admin/firestore';
import type { DecodedIdToken } from 'firebase-admin/auth';

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

export const POST = withAuth(async (request: NextRequest, token: DecodedIdToken) => {
  try {
    // Parse request body
    const body = await request.json();
    const { imageData, contentType } = body;

    if (!imageData || !contentType) {
      return NextResponse.json(
        { error: 'Missing image data or content type' },
        { status: 400 }
      );
    }

    // Validate content type
    if (!ALLOWED_TYPES.includes(contentType)) {
      return NextResponse.json(
        { error: 'Invalid file type. Allowed: JPEG, PNG, GIF, WebP' },
        { status: 400 }
      );
    }

    // Decode base64 image
    const base64Data = imageData.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');

    // Check file size
    if (buffer.length > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: 'File too large. Maximum size is 5MB' },
        { status: 400 }
      );
    }

    // Determine file extension
    const extension = contentType.split('/')[1] === 'jpeg' ? 'jpg' : contentType.split('/')[1];
    const fileName = `profile-photos/${token.uid}/avatar.${extension}`;

    // Upload to Firebase Storage
    const bucket = adminStorage.bucket();
    const file = bucket.file(fileName);

    await file.save(buffer, {
      metadata: {
        contentType,
        metadata: {
          uploadedBy: token.uid,
          uploadedAt: new Date().toISOString(),
        },
      },
    });

    // Generate a signed URL valid for 7 days — no public access on the file
    const [photoURL] = await file.getSignedUrl({
      action: 'read',
      expires: Date.now() + 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    // Update user document with signed URL and storage path (path allows re-signing later)
    const userRef = adminDb.collection('users').doc(token.uid);
    await userRef.update({
      photoURL,
      photoStoragePath: fileName,
      updatedAt: FieldValue.serverTimestamp(),
    });
    invalidateUserCache(token.uid);

    return NextResponse.json({ success: true, photoURL });
  } catch (error: unknown) {
    console.error('[user/upload-photo] error:', error);
    return NextResponse.json({ error: 'Failed to upload photo' }, { status: 500 });
  }
});
