import { NextResponse } from 'next/server';
import { withCandidate } from '@/lib/middleware/withCandidate';
import { readJsonBody } from '@/lib/middleware/apiHelpers';
import { requestUpload } from '@/lib/services/trainingService';
import { TrainingError } from '@/lib/training/errors';

/**
 * Candidate — sign one upload slot. The bytes go straight to Cloud Storage over
 * the returned URL (rule 9i); the URL stops working at the attempt's end plus the
 * grace, its path is server-chosen and its content type is pinned into the
 * signature. `{ kind: 'final', slotId, contentType, size }` is a final image;
 * `{ kind: 'work', fileName, size }` is a working file (any type, 250 MB).
 */
export const POST = withCandidate<{ moduleId: string; testId: string }>(async (request, { emailHash, params }) => {
  const read = await readJsonBody(request, 2 * 1024);
  if (!read.ok) return read.response;
  const b = (read.body ?? {}) as Record<string, unknown>;
  const size = Number(b.size);
  if (b.kind === 'final' && typeof b.slotId === 'string' && typeof b.contentType === 'string') {
    return NextResponse.json(
      await requestUpload(emailHash, params.moduleId, params.testId, { kind: 'final', slotId: b.slotId, contentType: b.contentType, size }),
    );
  }
  if (b.kind === 'work' && typeof b.fileName === 'string') {
    return NextResponse.json(
      await requestUpload(emailHash, params.moduleId, params.testId, { kind: 'work', fileName: b.fileName, size }),
    );
  }
  throw new TrainingError('Invalid request', 400);
});
