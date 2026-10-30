import { NextResponse } from 'next/server';
import { withCandidate } from '@/lib/middleware/withCandidate';
import { revealNext } from '@/lib/services/trainingService';

/**
 * Candidate — T7: Next. Shows one more image and returns every image shown so far. Past the last
 * image it changes nothing. Per-candidate and live: not cacheable (`no-store` via `withCandidate`).
 */
export const POST = withCandidate<{ moduleId: string; testId: string }>(async (_request, { emailHash, params }) => {
  return NextResponse.json(await revealNext(emailHash, params.moduleId, params.testId));
});
