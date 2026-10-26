import { NextResponse } from 'next/server';
import { withTrainingAdmin } from '@/lib/middleware/withTrainingAdmin';
import { stopSession } from '@/lib/services/trainingService';

/**
 * Stop a training session now (page permission `training`, `no-store`: a write).
 * Access ends immediately for everyone, including anyone mid-attempt; work
 * already uploaded is kept. Idempotent.
 */
export const POST = withTrainingAdmin<{ sessionId: string }>(async (_request, { params }) => {
  await stopSession(params.sessionId);
  return NextResponse.json({ ok: true });
});
