import { NextResponse } from 'next/server';
import { withCandidate } from '@/lib/middleware/withCandidate';
import { readJsonBody } from '@/lib/middleware/apiHelpers';
import { confirmScreenCheck, signScreenCheck } from '@/lib/services/trainingService';
import { TrainingError } from '@/lib/training/errors';

/**
 * Candidate — the screen check Start requires. `{ action: 'sign' }` signs the
 * upload of one still grabbed from the screen share; the browser PUTs it straight
 * to Storage; `{ action: 'confirm', checkId }` verifies the object (a real JPEG,
 * just created) and records the check.
 */
export const POST = withCandidate<{ sessionId: string; partId: string }>(async (request, { emailHash, params }) => {
  const read = await readJsonBody(request, 1024);
  if (!read.ok) return read.response;
  const b = (read.body ?? {}) as Record<string, unknown>;
  if (b.action === 'sign') {
    return NextResponse.json(await signScreenCheck(emailHash, params.sessionId, params.partId));
  }
  if (b.action === 'confirm' && typeof b.checkId === 'string') {
    return NextResponse.json(await confirmScreenCheck(emailHash, params.sessionId, params.partId, b.checkId));
  }
  throw new TrainingError('Invalid request', 400);
});
