import { NextResponse } from 'next/server';
import { withCandidate } from '@/lib/middleware/withCandidate';
import { getSequence } from '@/lib/services/trainingService';

/** Candidate — T7: every image shown so far, with its saved answer. Nothing past the last one shown. */
export const GET = withCandidate<{ moduleId: string; testId: string }>(async (_request, { emailHash, params }) => {
  return NextResponse.json(await getSequence(emailHash, params.moduleId, params.testId));
});
