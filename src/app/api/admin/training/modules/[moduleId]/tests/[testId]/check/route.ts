import { NextResponse } from 'next/server';
import { withTrainingAdmin } from '@/lib/middleware/withTrainingAdmin';
import { checkDrive } from '@/lib/training/drive';

/**
 * GET — Check Drive: a dry-run diff of what Open would copy for this test
 * (added / changed / removed per folder) and whether the folders hold what the
 * test asks for. Writes nothing. Reads Drive, so it is an admin's deliberate
 * click, never a poll.
 */
export const maxDuration = 60;

export const GET = withTrainingAdmin<{ moduleId: string; testId: string }>(async (_request, { params }) => {
  return NextResponse.json(await checkDrive(params.moduleId, params.testId));
});
