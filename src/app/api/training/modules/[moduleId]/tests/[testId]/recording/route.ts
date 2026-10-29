import { NextResponse } from 'next/server';
import { withCandidate } from '@/lib/middleware/withCandidate';
import { readJsonBody } from '@/lib/middleware/apiHelpers';
import { requestRecordingSlots } from '@/lib/services/trainingRecordingService';
import { TrainingError } from '@/lib/training/errors';
import { isRecordingType } from '@/lib/training/recording';

/**
 * Candidate — sign the next batch of screen-recording segment uploads. The
 * video goes straight to Storage (rule 9i); one call covers a minute of it.
 */
export const POST = withCandidate<{ moduleId: string; testId: string }>(async (request, { emailHash, params }) => {
  const read = await readJsonBody(request, 512);
  if (!read.ok) return read.response;
  const contentType = (read.body as { contentType?: unknown } | null)?.contentType;
  if (!isRecordingType(contentType)) throw new TrainingError('Invalid request', 400);
  return NextResponse.json(await requestRecordingSlots(emailHash, params.moduleId, params.testId, contentType));
});
