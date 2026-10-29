import { NextResponse } from 'next/server';
import { withTrainingAdmin } from '@/lib/middleware/withTrainingAdmin';
import { readJsonBody } from '@/lib/middleware/apiHelpers';
import { TrainingError } from '@/lib/training/errors';
import { syncFile } from '@/lib/training/drive';
import { getTest, materialKeysFor } from '@/lib/training/modules';

/**
 * POST { key, driveId } — copy ONE planned file from Drive into Storage. One per
 * call because a test is ~120 files, far too many for one invocation. `syncFile`
 * only honours a Drive id the plan put in the manifest, so this route cannot be
 * used to fetch an arbitrary Drive file; the key must also belong to this test.
 */
export const maxDuration = 60;

export const POST = withTrainingAdmin<{ moduleId: string; testId: string }>(async (request, { params }) => {
  const test = getTest(params.moduleId, params.testId);
  if (!test) throw new TrainingError('Unknown test', 404);

  const parsed = await readJsonBody(request, 1024);
  if (!parsed.ok) return parsed.response;
  const { key, driveId } = (parsed.body ?? {}) as { key?: unknown; driveId?: unknown };
  if (typeof key !== 'string' || typeof driveId !== 'string' || !/^[\w-]{10,80}$/.test(driveId)) {
    throw new TrainingError('Invalid request', 400);
  }
  if (!materialKeysFor(test).includes(key)) throw new TrainingError('That file is not part of this test', 400);

  return NextResponse.json(await syncFile(params.moduleId, key, driveId));
});
