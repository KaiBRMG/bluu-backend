import { NextResponse } from 'next/server';
import { withCandidate } from '@/lib/middleware/withCandidate';
import { readJsonBody } from '@/lib/middleware/apiHelpers';
import { finalizeUpload } from '@/lib/services/trainingService';
import { TrainingError } from '@/lib/training/errors';

/** Candidate — record an upload the browser finished. The server verifies the object itself. */
export const POST = withCandidate<{ sessionId: string; partId: string }>(async (request, { emailHash, params }) => {
  const read = await readJsonBody(request, 1024);
  if (!read.ok) return read.response;
  const uploadId = (read.body as { uploadId?: unknown } | null)?.uploadId;
  if (typeof uploadId !== 'string') throw new TrainingError('Invalid request', 400);
  await finalizeUpload(emailHash, params.sessionId, params.partId, uploadId);
  return NextResponse.json({ ok: true });
});
