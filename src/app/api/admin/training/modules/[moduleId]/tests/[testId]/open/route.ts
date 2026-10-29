import { NextResponse } from 'next/server';
import { withTrainingAdmin } from '@/lib/middleware/withTrainingAdmin';
import { openTest } from '@/lib/services/trainingService';

/**
 * POST — open the test for candidates. Refused unless the module is on, no other
 * test is open, and every Drive manifest the test needs is complete (checked on
 * the server, not just in the page).
 */
export const POST = withTrainingAdmin<{ moduleId: string; testId: string }>(async (_request, { params }) => {
  await openTest(params.moduleId, params.testId);
  return NextResponse.json({ ok: true });
});
