import { NextResponse } from 'next/server';
import { withCandidate } from '@/lib/middleware/withCandidate';
import { finishAttempt } from '@/lib/services/trainingService';

/** Candidate — end the part early. Irreversible. */
export const POST = withCandidate<{ sessionId: string; partId: string }>(async (_request, { emailHash, params }) => {
  await finishAttempt(emailHash, params.sessionId, params.partId);
  return NextResponse.json({ ok: true });
});
