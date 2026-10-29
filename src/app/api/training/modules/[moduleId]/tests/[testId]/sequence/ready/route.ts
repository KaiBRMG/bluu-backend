import { NextResponse } from 'next/server';
import { withCandidate } from '@/lib/middleware/withCandidate';
import { readJsonBody } from '@/lib/middleware/apiHelpers';
import { markWindowReady } from '@/lib/services/trainingService';
import { TrainingError } from '@/lib/training/errors';

/**
 * Candidate — T7: image `index` has rendered, so its window starts now. The first ack wins and the
 * server caps the wait, so this can only start a window, never lengthen or restart one.
 * Per-candidate and live: it is not cacheable.
 */
export const POST = withCandidate<{ moduleId: string; testId: string }>(async (request, { emailHash, params }) => {
  const read = await readJsonBody(request, 1024);
  if (!read.ok) return read.response;
  const b = (read.body ?? {}) as { index?: unknown };
  if (typeof b.index !== 'number') throw new TrainingError('Invalid request', 400);
  return NextResponse.json(await markWindowReady(emailHash, params.moduleId, params.testId, b.index));
});
