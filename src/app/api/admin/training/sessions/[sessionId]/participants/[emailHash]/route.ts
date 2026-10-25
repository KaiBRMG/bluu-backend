import { NextResponse } from 'next/server';
import { withTrainingAdmin } from '@/lib/middleware/withTrainingAdmin';
import { getSubmission } from '@/lib/services/trainingService';

/**
 * One candidate's work on one part (page permission `training`): their uploads
 * beside the source images they used. Signed read URLs, so `no-store`.
 * `?part=<partId>` is required.
 */
export const GET = withTrainingAdmin<{ sessionId: string; emailHash: string }>(async (request, { params }) => {
  const partId = new URL(request.url).searchParams.get('part') ?? '';
  return NextResponse.json(await getSubmission(params.sessionId, params.emailHash, partId));
});
