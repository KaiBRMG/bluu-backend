import { NextResponse } from 'next/server';
import { readJsonBody } from '@/lib/middleware/apiHelpers';
import { withTrainingAdmin } from '@/lib/middleware/withTrainingAdmin';
import { reopenParticipant } from '@/lib/services/trainingService';
import { TrainingError } from '@/lib/training/errors';

/**
 * Reopen one candidate's part (page permission `training`, `no-store`: a
 * write). Gives them a fresh full clock on the same attempt, keeping what they
 * already uploaded, and lets them in even if the session has ended.
 * Body: `{ partId }`.
 */
export const POST = withTrainingAdmin<{ sessionId: string; emailHash: string }>(async (request, { params }) => {
  const read = await readJsonBody(request, 1024);
  if (!read.ok) return read.response;
  const partId = (read.body as { partId?: unknown } | null)?.partId;
  if (typeof partId !== 'string' || !/^[a-f0-9]{32}$/.test(params.emailHash)) {
    throw new TrainingError('Invalid request', 400);
  }
  await reopenParticipant(params.sessionId, params.emailHash, partId);
  return NextResponse.json({ ok: true });
});
