import { NextResponse } from 'next/server';
import { withCandidate } from '@/lib/middleware/withCandidate';
import { getMe } from '@/lib/services/trainingService';

/**
 * Candidate — who am I, and which sittings and parts can I see.
 *
 * Per-person and time-sensitive (a part's state flips when it opens), so it is
 * `no-store` — set by `withCandidate`. The response carries the server clock so
 * the browser can correct for a wrong device clock.
 */
export const GET = withCandidate(async (_request, { emailHash }) => {
  return NextResponse.json(await getMe(emailHash));
});
