import { NextResponse } from 'next/server';
import { readJsonBody } from '@/lib/middleware/apiHelpers';
import { withTrainingAdmin } from '@/lib/middleware/withTrainingAdmin';
import { commitSource, removeSource, signSourceUpload } from '@/lib/services/trainingService';
import { TrainingError } from '@/lib/training/errors';

/**
 * A part's source images (page permission `training`, `no-store`: writes).
 *
 *   POST { action: 'sign',   partId, contentType, size, previewSize }  → signed PUTs
 *   POST { action: 'commit', partId, imageId, name, contentType }      → record it
 *   DELETE { partId, imageId }                                         → remove it (any time) → { retired }
 *
 * The bytes never cross a function (rule 9i): the browser PUTs the original
 * and a small preview it made itself straight to Storage. `commit` verifies
 * both objects before recording either.
 */
export const POST = withTrainingAdmin<{ sessionId: string }>(async (request, { params }) => {
  const read = await readJsonBody(request, 4 * 1024);
  if (!read.ok) return read.response;
  const b = (read.body ?? {}) as Record<string, unknown>;
  const partId = typeof b.partId === 'string' ? b.partId : '';

  if (b.action === 'sign') {
    return NextResponse.json(
      await signSourceUpload(params.sessionId, partId, {
        contentType: typeof b.contentType === 'string' ? b.contentType : '',
        size: Number(b.size),
        previewSize: Number(b.previewSize),
      }),
    );
  }
  if (b.action === 'commit') {
    await commitSource(params.sessionId, partId, {
      imageId: typeof b.imageId === 'string' ? b.imageId : '',
      name: typeof b.name === 'string' ? b.name : '',
      contentType: typeof b.contentType === 'string' ? b.contentType : '',
    });
    return NextResponse.json({ ok: true });
  }
  throw new TrainingError('Invalid request', 400);
});

export const DELETE = withTrainingAdmin<{ sessionId: string }>(async (request, { params }) => {
  const read = await readJsonBody(request, 1024);
  if (!read.ok) return read.response;
  const b = (read.body ?? {}) as Record<string, unknown>;
  if (typeof b.partId !== 'string' || typeof b.imageId !== 'string') throw new TrainingError('Invalid request', 400);
  return NextResponse.json(await removeSource(params.sessionId, b.partId, b.imageId));
});
