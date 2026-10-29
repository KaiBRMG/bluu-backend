import { after, NextResponse } from 'next/server';
import { withCandidate } from '@/lib/middleware/withCandidate';
import { finishAttempt } from '@/lib/services/trainingService';
import { mirrorRecord } from '@/lib/training/mirror';

export const maxDuration = 60;

/**
 * Candidate — end the test early (irreversible; uploaded work is kept), or, once
 * the clock has ended, the room's cue that it is over: either way the task record
 * is written to Drive after the response. Idempotent and cheap to repeat — the
 * copy is skipped when Drive already holds the same text.
 */
export const POST = withCandidate<{ moduleId: string; testId: string }>(async (_request, { emailHash, params }) => {
  await finishAttempt(emailHash, params.moduleId, params.testId);
  after(() => mirrorRecord(params.moduleId, emailHash, params.testId));
  return NextResponse.json({ ok: true });
});
