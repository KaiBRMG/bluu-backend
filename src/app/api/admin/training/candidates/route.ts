import { NextResponse } from 'next/server';
import { withTrainingAdmin } from '@/lib/middleware/withTrainingAdmin';
import { listCandidates } from '@/lib/services/trainingService';

/**
 * Every training candidate, one row each, with their current standing (page
 * permission `training`, `no-store`: states flip on the server clock). Read when
 * the Candidates tab is opened — it is not polled.
 */
export const GET = withTrainingAdmin(async () => {
  return NextResponse.json(await listCandidates());
});
