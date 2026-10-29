import { NextResponse } from 'next/server';
import { withCandidate } from '@/lib/middleware/withCandidate';
import { getTestForCandidate } from '@/lib/services/trainingService';

/**
 * Candidate — one test: its state, and while the attempt is in progress the
 * source images and the work uploaded so far.
 *
 * The source images are signed here ONLY for an attempt in progress, so the
 * briefing cannot leak them. `no-store` via `withCandidate`: the signed URLs
 * and the clock must never come from a cache.
 */
export const GET = withCandidate<{ moduleId: string; testId: string }>(async (_request, { emailHash, params }) => {
  return NextResponse.json(await getTestForCandidate(emailHash, params.moduleId, params.testId));
});
