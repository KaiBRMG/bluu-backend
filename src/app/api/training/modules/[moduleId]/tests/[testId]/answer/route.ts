import { NextResponse } from 'next/server';
import { withCandidate } from '@/lib/middleware/withCandidate';
import { readJsonBody } from '@/lib/middleware/apiHelpers';
import { saveAnswer } from '@/lib/services/trainingService';
import { TrainingError } from '@/lib/training/errors';

/** Candidate — T7: the answer for image `index`. Accepted only inside that image's window. */
export const POST = withCandidate<{ moduleId: string; testId: string }>(async (request, { emailHash, params }) => {
  const read = await readJsonBody(request, 8 * 1024);
  if (!read.ok) return read.response;
  const b = (read.body ?? {}) as { index?: unknown; text?: unknown };
  if (typeof b.index !== 'number' || typeof b.text !== 'string') throw new TrainingError('Invalid request', 400);
  await saveAnswer(emailHash, params.moduleId, params.testId, b.index, b.text);
  return NextResponse.json({ ok: true });
});
