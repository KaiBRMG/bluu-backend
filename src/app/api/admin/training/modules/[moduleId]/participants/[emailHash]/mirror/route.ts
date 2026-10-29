import { NextResponse } from 'next/server';
import { readJsonBody } from '@/lib/middleware/apiHelpers';
import { withTrainingAdmin } from '@/lib/middleware/withTrainingAdmin';
import { TrainingError } from '@/lib/training/errors';
import { isEmailHash } from '@/lib/training/model';
import { mirrorAttempt } from '@/lib/training/mirror';
import { getTest } from '@/lib/training/modules';

export const maxDuration = 300;

/**
 * Retry the Drive copy of one attempt's files (page permission `training`,
 * `no-store`: a write). Body: `{ testId }`. Runs inline so the admin sees the
 * result on the roster straight away; only files not already synced are copied.
 */
export const POST = withTrainingAdmin<{ moduleId: string; emailHash: string }>(async (request, { params }) => {
  const read = await readJsonBody(request, 1024);
  if (!read.ok) return read.response;
  const testId = (read.body as { testId?: unknown } | null)?.testId;
  if (typeof testId !== 'string' || !getTest(params.moduleId, testId) || !isEmailHash(params.emailHash)) {
    throw new TrainingError('Invalid request', 400);
  }
  return NextResponse.json({ copied: await mirrorAttempt(params.moduleId, params.emailHash, testId) });
});
