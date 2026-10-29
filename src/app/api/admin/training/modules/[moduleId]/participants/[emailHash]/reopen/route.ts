import { NextResponse } from 'next/server';
import { readJsonBody } from '@/lib/middleware/apiHelpers';
import { withTrainingAdmin } from '@/lib/middleware/withTrainingAdmin';
import { reopenParticipant } from '@/lib/services/trainingService';
import { TrainingError } from '@/lib/training/errors';
import { isEmailHash } from '@/lib/training/model';

/**
 * Reopen one candidate's test (page permission `training`, `no-store`: a write).
 * Gives them a fresh full clock on the same attempt, keeping what they already
 * uploaded. Body: `{ testId }`.
 */
export const POST = withTrainingAdmin<{ moduleId: string; emailHash: string }>(async (request, { params }) => {
  const read = await readJsonBody(request, 1024);
  if (!read.ok) return read.response;
  const testId = (read.body as { testId?: unknown } | null)?.testId;
  if (typeof testId !== 'string' || !isEmailHash(params.emailHash)) {
    throw new TrainingError('Invalid request', 400);
  }
  await reopenParticipant(params.moduleId, params.emailHash, testId);
  return NextResponse.json({ ok: true });
});
