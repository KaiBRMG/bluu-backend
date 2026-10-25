import { NextResponse } from 'next/server';
import { withCandidate } from '@/lib/middleware/withCandidate';
import { readJsonBody } from '@/lib/middleware/apiHelpers';
import { requestUpload } from '@/lib/services/trainingService';
import { TrainingError } from '@/lib/training/errors';

/**
 * Candidate — sign one upload slot. The bytes go straight to Cloud Storage over
 * the returned URL (rule 9i); the URL stops working at `deadline + grace`, its
 * path is server-chosen and its content type is pinned into the signature.
 */
export const POST = withCandidate<{ sessionId: string; partId: string }>(async (request, { emailHash, params }) => {
  const read = await readJsonBody(request, 2 * 1024);
  if (!read.ok) return read.response;
  const b = (read.body ?? {}) as Record<string, unknown>;
  if (typeof b.slotId !== 'string' || typeof b.sourceId !== 'string' || typeof b.contentType !== 'string') {
    throw new TrainingError('Invalid request', 400);
  }
  return NextResponse.json(
    await requestUpload(emailHash, params.sessionId, params.partId, {
      slotId: b.slotId,
      sourceId: b.sourceId,
      contentType: b.contentType,
      size: Number(b.size),
    }),
  );
});
