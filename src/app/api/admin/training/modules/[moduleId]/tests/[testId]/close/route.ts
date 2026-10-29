import { NextResponse } from 'next/server';
import { withTrainingAdmin } from '@/lib/middleware/withTrainingAdmin';
import { closeTest } from '@/lib/services/trainingService';

/** POST — close the test: no new Starts; clocks already running finish. Also cancels an abandoned prepare. */
export const POST = withTrainingAdmin<{ moduleId: string; testId: string }>(async (_request, { params }) => {
  await closeTest(params.moduleId, params.testId);
  return NextResponse.json({ ok: true });
});
