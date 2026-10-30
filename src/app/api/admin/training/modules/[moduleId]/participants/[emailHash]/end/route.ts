import { after, NextResponse } from 'next/server';
import { readJsonBody } from '@/lib/middleware/apiHelpers';
import { withTrainingAdmin } from '@/lib/middleware/withTrainingAdmin';
import { endAttempt } from '@/lib/services/trainingService';
import { TrainingError } from '@/lib/training/errors';
import { isEmailHash } from '@/lib/training/model';
import { mirrorRecord } from '@/lib/training/mirror';
import { getTest } from '@/lib/training/modules';

export const maxDuration = 60;

/**
 * End one candidate's running test now (page permission `training`, `no-store`: a write) — the way
 * to stop a reopened attempt without switching the whole module off. Uploaded work is kept, and the
 * task record is written to Drive after the response. Body: `{ testId }`. Reopen undoes it.
 */
export const POST = withTrainingAdmin<{ moduleId: string; emailHash: string }>(async (request, { params }) => {
  const read = await readJsonBody(request, 1024);
  if (!read.ok) return read.response;
  const testId = (read.body as { testId?: unknown } | null)?.testId;
  if (typeof testId !== 'string' || !getTest(params.moduleId, testId) || !isEmailHash(params.emailHash)) {
    throw new TrainingError('Invalid request', 400);
  }
  await endAttempt(params.moduleId, params.emailHash, testId);
  after(() => mirrorRecord(params.moduleId, params.emailHash, testId));
  return NextResponse.json({ ok: true });
});
