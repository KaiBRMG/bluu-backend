import { NextResponse } from 'next/server';
import { withCandidate } from '@/lib/middleware/withCandidate';
import { readJsonBody } from '@/lib/middleware/apiHelpers';
import { cleanName, setCandidateName } from '@/lib/services/trainingAuthService';
import { isApproved } from '@/lib/services/trainingService';
import { TrainingError } from '@/lib/training/errors';
import { MAX_NAME_LENGTH, MIN_NAME_LENGTH } from '@/lib/training/modules';

/**
 * Candidate — first-visit name capture. Set once; a repeat call returns the
 * stored name, so a candidate cannot rename themselves mid-sitting. `no-store`
 * via `withCandidate`.
 */
export const POST = withCandidate(async (request, { emailHash }) => {
  const read = await readJsonBody(request, 1024);
  if (!read.ok) return read.response;
  const name = cleanName((read.body as { name?: unknown } | null)?.name, MIN_NAME_LENGTH, MAX_NAME_LENGTH);
  if (!name) throw new TrainingError('Enter your full name', 400);
  if (!(await isApproved(emailHash))) throw new TrainingError('Not found', 404);
  return NextResponse.json({ name: await setCandidateName(emailHash, name) });
});
