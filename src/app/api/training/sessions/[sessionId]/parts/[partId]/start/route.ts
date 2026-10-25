import { NextResponse } from 'next/server';
import { withCandidate } from '@/lib/middleware/withCandidate';
import { getPartForCandidate, startAttempt } from '@/lib/services/trainingService';

/**
 * Candidate — start the clock. A transaction on the server, idempotent: a
 * second Start returns the attempt already running with its original deadline.
 * Returns the part so the browser can render the task from one round trip.
 */
export const POST = withCandidate<{ sessionId: string; partId: string }>(async (_request, { emailHash, params }) => {
  await startAttempt(emailHash, params.sessionId, params.partId);
  return NextResponse.json(await getPartForCandidate(emailHash, params.sessionId, params.partId));
});
