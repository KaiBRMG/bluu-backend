import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { withAuth } from '@/lib/middleware/withAuth';
import { handleApiError } from '@/lib/middleware/apiHelpers';
import { adminStorage } from '@/lib/firebase-admin';
import { requireOnlyFansAccess } from '@/lib/services/onlyfansService';
import {
  ALLOWED_UPLOAD_TYPES,
  MAX_UPLOAD_BYTES,
  OF_UPLOAD_PREFIX,
} from '@/lib/onlyfansUpload';
import type { DecodedIdToken } from 'firebase-admin/auth';

/** How long the browser has to complete the PUT. Generous — this is a 100MB ceiling. */
const SIGNED_WRITE_TTL_MS = 15 * 60 * 1000;

/**
 * POST /api/onlyfans/media/upload-url — sign a one-off upload slot.
 *
 * **Why this exists at all.** A Vercel function accepts roughly 4.5MB of request
 * body, and the media an operator sends is routinely larger. So the bytes never
 * pass through us: the browser PUTs the file straight to Cloud Storage using the
 * URL signed here, then calls `POST /api/onlyfans/media/upload` to hand it to
 * the provider.
 *
 * **Why it needs no Storage rules.** A v4 signed URL authenticates as the
 * service account against the GCS API, so Firebase Storage rules are not
 * consulted on either leg. The authorisation that matters is this route: the
 * OnlyFans page permission, an allowlisted content type, and a **server-chosen
 * path** the caller cannot influence. Signing a client-supplied path would be a
 * write primitive for the whole bucket.
 *
 * The signature pins the content type, so the PUT must send exactly the type
 * declared here or Storage rejects it — the allowlist cannot be sidestepped by
 * lying at upload time.
 */
export const POST = withAuth(async (request: NextRequest, token: DecodedIdToken) => {
  const denied = await requireOnlyFansAccess(token.uid);
  if (denied) return denied;

  const body = await request.json().catch(() => null);
  const contentType = typeof body?.contentType === 'string' ? body.contentType : '';
  const size = Number(body?.size);

  const extension = ALLOWED_UPLOAD_TYPES[contentType];
  if (!extension) {
    return NextResponse.json({ error: 'That file type cannot be sent' }, { status: 400 });
  }
  if (!Number.isFinite(size) || size <= 0 || size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: 'That file is too large' }, { status: 400 });
  }

  try {
    // Per-uid and server-named: the caller picks neither the folder nor the
    // file, so one operator can never overwrite or address another's upload.
    const path = `${OF_UPLOAD_PREFIX}/${token.uid}/${randomUUID()}.${extension}`;

    const [uploadUrl] = await adminStorage
      .bucket()
      .file(path)
      .getSignedUrl({
        version: 'v4',
        action: 'write',
        expires: Date.now() + SIGNED_WRITE_TTL_MS,
        contentType,
      });

    return NextResponse.json({ uploadUrl, path, contentType });
  } catch (error) {
    return handleApiError(error, 'POST /api/onlyfans/media/upload-url');
  }
});
