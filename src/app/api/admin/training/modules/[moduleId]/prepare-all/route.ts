import { NextResponse } from 'next/server';
import { withTrainingAdmin } from '@/lib/middleware/withTrainingAdmin';
import { beginPrepareAll } from '@/lib/services/trainingService';
import { planSyncAll } from '@/lib/training/drive';

/**
 * POST — the first step of "Open all tests": diff every folder the module's tests read against
 * the manifests and return the to-do list (each folder once). The page then calls
 * `prepare-all/file` once per entry and finally PATCHes `{ allTestsOpen: true }`, which refuses
 * until every test's materials are in. Idempotent, so an interrupted run is resumed by toggling
 * again. Refused once all tests are open (materials freeze while candidates may be using them).
 * `no-store`: an admin action.
 */
export const maxDuration = 120;

export const POST = withTrainingAdmin<{ moduleId: string }>(async (_request, { params }) => {
  const frozen = await beginPrepareAll(params.moduleId);
  return NextResponse.json(await planSyncAll(params.moduleId, frozen));
});
