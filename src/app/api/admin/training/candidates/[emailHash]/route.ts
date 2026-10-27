import { NextResponse } from 'next/server';
import { withTrainingAdmin } from '@/lib/middleware/withTrainingAdmin';
import { getCandidateDetail } from '@/lib/services/trainingService';

/**
 * One candidate across every session: each part's state and what they handed in
 * (page permission `training`). Signed read URLs, so `no-store`.
 */
export const GET = withTrainingAdmin<{ emailHash: string }>(async (_request, { params }) => {
  return NextResponse.json(await getCandidateDetail(params.emailHash));
});
