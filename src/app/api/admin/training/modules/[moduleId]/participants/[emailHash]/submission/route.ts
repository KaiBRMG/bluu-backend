import { NextResponse } from 'next/server';
import { withTrainingAdmin } from '@/lib/middleware/withTrainingAdmin';
import { getSubmission } from '@/lib/services/trainingService';

/** One candidate's work on one test (`?test=`): finals beside their sources, working files, the record, T7's answers. */
export const GET = withTrainingAdmin<{ moduleId: string; emailHash: string }>(async (request, { params }) => {
  const testId = new URL(request.url).searchParams.get('test') ?? '';
  return NextResponse.json(await getSubmission(params.moduleId, params.emailHash, testId));
});
