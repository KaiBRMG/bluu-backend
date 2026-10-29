import { after, NextResponse } from 'next/server';
import { withCandidate } from '@/lib/middleware/withCandidate';
import { readJsonBody } from '@/lib/middleware/apiHelpers';
import { finalizeUpload } from '@/lib/services/trainingService';
import { mirrorFile, trashDriveCopy } from '@/lib/training/mirror';
import { TrainingError } from '@/lib/training/errors';

/**
 * 300 s because the Drive copy of a 250 MB working file runs in `after()`, which
 * counts against this function's duration — the candidate's response does not wait.
 */
export const maxDuration = 300;

/**
 * Candidate — record an upload the browser finished. The server verifies the
 * object itself; the copy to the shared drive happens after the response, and a
 * failure there is marked on the file (and retried by the daily sweep), never
 * returned to the candidate.
 */
export const POST = withCandidate<{ moduleId: string; testId: string }>(async (request, { emailHash, params }) => {
  const read = await readJsonBody(request, 1024);
  if (!read.ok) return read.response;
  const uploadId = (read.body as { uploadId?: unknown } | null)?.uploadId;
  if (typeof uploadId !== 'string') throw new TrainingError('Invalid request', 400);
  const { target, replacedDriveFileId } = await finalizeUpload(emailHash, params.moduleId, params.testId, uploadId);
  // The old copy and the new one are different Drive files; neither waits for the other.
  after(() =>
    Promise.all([
      trashDriveCopy(replacedDriveFileId).catch((e) => console.error('[training/mirror] trash', e)),
      mirrorFile(params.moduleId, emailHash, params.testId, target),
    ]),
  );
  return NextResponse.json({ ok: true });
});
