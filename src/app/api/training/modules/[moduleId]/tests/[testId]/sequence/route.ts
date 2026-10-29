import { NextResponse } from 'next/server';
import { withCandidate } from '@/lib/middleware/withCandidate';
import { getSequence } from '@/lib/services/trainingService';

/** Candidate — T7: the ONE image that is current right now, signed until its window ends. Nothing before, nothing after. */
export const GET = withCandidate<{ moduleId: string; testId: string }>(async (_request, { emailHash, params }) => {
  return NextResponse.json(await getSequence(emailHash, params.moduleId, params.testId));
});
