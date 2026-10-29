import { NextResponse } from 'next/server';
import { withTrainingAdmin } from '@/lib/middleware/withTrainingAdmin';
import { beginPrepare } from '@/lib/services/trainingService';
import { planSync } from '@/lib/training/drive';

/**
 * POST — start (or resume) preparing a test: diff Drive against the manifests,
 * drop what Drive no longer has, and return the to-do list. The page then calls
 * `prepare/file` once per entry. Idempotent, so an abandoned prepare is resumed
 * by pressing it again. Marks the test `preparing` (refused while another test
 * is open — only one at a time).
 */
export const maxDuration = 60;

export const POST = withTrainingAdmin<{ moduleId: string; testId: string }>(async (_request, { params }) => {
  await beginPrepare(params.moduleId, params.testId);
  return NextResponse.json(await planSync(params.moduleId, params.testId));
});
