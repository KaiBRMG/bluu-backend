import { NextResponse } from 'next/server';
import { readJsonBody } from '@/lib/middleware/apiHelpers';
import { withTrainingAdmin } from '@/lib/middleware/withTrainingAdmin';
import { getModuleDetail, setAllTestsOpen, setModuleOn } from '@/lib/services/trainingService';
import { TrainingError } from '@/lib/training/errors';

/**
 * One module — the tests with their status and the roster with each person's
 * state per test (page permission `training`, `no-store`: states flip on the
 * server clock). PATCH `{ on }` is the switch; OFF is a hard stop. PATCH
 * `{ allTestsOpen }` is "Open all tests" (refused until every test's materials are in).
 */
export const GET = withTrainingAdmin<{ moduleId: string }>(async (_request, { params }) => {
  return NextResponse.json(await getModuleDetail(params.moduleId));
});

export const PATCH = withTrainingAdmin<{ moduleId: string }>(async (request, { params }) => {
  const read = await readJsonBody(request, 512);
  if (!read.ok) return read.response;
  const { on, allTestsOpen } = (read.body ?? {}) as { on?: unknown; allTestsOpen?: unknown };
  if (typeof on === 'boolean') await setModuleOn(params.moduleId, on);
  else if (typeof allTestsOpen === 'boolean') await setAllTestsOpen(params.moduleId, allTestsOpen);
  else throw new TrainingError('Invalid request', 400);
  return NextResponse.json({ ok: true });
});
