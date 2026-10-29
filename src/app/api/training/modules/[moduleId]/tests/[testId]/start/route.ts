import { NextResponse } from 'next/server';
import { withCandidate } from '@/lib/middleware/withCandidate';
import { getTestForCandidate, startAttempt } from '@/lib/services/trainingService';

/** Candidate — start the clock. Idempotent: a second Start returns the attempt already running. Returns the test, sources included, so the room opens on a running clock. */
export const POST = withCandidate<{ moduleId: string; testId: string }>(async (_request, { emailHash, params }) => {
  await startAttempt(emailHash, params.moduleId, params.testId);
  return NextResponse.json(await getTestForCandidate(emailHash, params.moduleId, params.testId));
});
