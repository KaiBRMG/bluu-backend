import { NextRequest, NextResponse } from 'next/server';
import { MAX_UPLOAD_BYTES } from '@/lib/modelSubmissions';
import {
  ImageRejected,
  clientIp,
  consumeRate,
  hashIp,
  ingestImage,
  loadSession,
  releaseUpload,
  reserveUploadSlot,
} from '@/lib/services/modelSubmissionService';

export const maxDuration = 60;

const KINDS = ['selfie', 'body', 'earnings'] as const;
type Kind = (typeof KINDS)[number];

/**
 * PUBLIC — accepts one image against an open submission session.
 *
 * Defence in depth, in order: signed session token → per-IP daily upload quota
 * → per-session file slot → byte cap → `sharp` decode (format is proven, not
 * claimed) → re-encode, which strips EXIF/GPS. The returned id is the only
 * handle the client gets; storage paths never leave the server.
 */
export async function POST(request: NextRequest) {
  try {
    const form = await request.formData().catch(() => null);
    if (!form) {
      return NextResponse.json({ error: 'Invalid upload.' }, { status: 400 });
    }

    const sessionId = String(form.get('sessionId') ?? '');
    const token = String(form.get('token') ?? '');
    const kind = String(form.get('kind') ?? '') as Kind;
    const file = form.get('file');

    if (!KINDS.includes(kind)) {
      return NextResponse.json({ error: 'Invalid upload.' }, { status: 400 });
    }
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'No image received.' }, { status: 400 });
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json({ error: 'That image is too large — keep it under 12MB.' }, { status: 413 });
    }

    const session = await loadSession(sessionId, token);
    if (!session) {
      return NextResponse.json(
        { error: 'Your form session expired. Refresh the page to start again.' },
        { status: 401 },
      );
    }

    const ipHash = hashIp(clientIp(request.headers));
    if (!(await consumeRate(ipHash, 'uploads'))) {
      console.warn('[model-submissions/upload] daily upload quota reached', { ipHash });
      return NextResponse.json(
        { error: 'Too many uploads from this connection. Try again tomorrow.' },
        { status: 429 },
      );
    }

    const slot = await reserveUploadSlot(sessionId);
    if (slot !== 'ok') {
      console.warn('[model-submissions/upload] slot refused', { sessionId, slot });
      return NextResponse.json(
        {
          error:
            slot === 'full'
              ? 'You have reached the photo limit. Remove one to add another.'
              : slot === 'exhausted'
                ? 'Too many upload attempts on this form. Refresh the page to start again.'
                : 'Your form session expired. Refresh the page to start again.',
        },
        { status: slot === 'invalid' ? 401 : 429 },
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const { id, photo } = await ingestImage(sessionId, kind, buffer);

    return NextResponse.json({ id, width: photo.width, height: photo.height });
  } catch (error) {
    if (error instanceof ImageRejected) {
      console.warn('[model-submissions/upload] image rejected:', error.message);
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    // Anything reaching here is ours, not the applicant's — most often `sharp`
    // failing to load or a Storage write being refused. Log it loudly: the
    // applicant only ever sees "try again", so the server log is the only
    // record of why a retry keeps failing.
    console.error('[model-submissions/upload] unexpected failure:', error);
    return NextResponse.json({ error: 'Upload failed. Please try again.' }, { status: 500 });
  }
}

/**
 * PUBLIC — releases a photo the applicant removed.
 *
 * Deletes the stored objects and gives the session its slot back, so replacing
 * a photo never costs capacity. Session-token gated exactly like the upload,
 * and the id must already exist in *this* session's manifest, so it can only
 * ever delete something this session created.
 */
export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
    }

    const sessionId = String(body.sessionId ?? '');
    const token = String(body.token ?? '');
    const photoId = String(body.id ?? '');
    if (!/^[a-f0-9]{16}$/.test(photoId)) {
      return NextResponse.json({ error: 'Invalid photo id.' }, { status: 400 });
    }

    const session = await loadSession(sessionId, token);
    if (!session) {
      return NextResponse.json({ error: 'Your form session expired.' }, { status: 401 });
    }

    await releaseUpload(sessionId, photoId);
    // Always 200: the tile is already gone from the applicant's screen, and a
    // failed release is our bookkeeping problem, not something to interrupt
    // them with.
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[model-submissions/upload DELETE]', error);
    return NextResponse.json({ ok: true });
  }
}
