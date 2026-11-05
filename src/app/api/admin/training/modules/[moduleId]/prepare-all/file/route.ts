import { NextResponse } from 'next/server';
import { withTrainingAdmin } from '@/lib/middleware/withTrainingAdmin';
import { readJsonBody } from '@/lib/middleware/apiHelpers';
import { TrainingError } from '@/lib/training/errors';
import { moduleMaterialKeys, syncFile } from '@/lib/training/drive';

/**
 * POST { key, driveId } — copy ONE planned file for "Open all tests", the module-wide twin of
 * `tests/[testId]/prepare/file`. `syncFile` only honours a Drive id the plan put in the manifest,
 * so this cannot fetch an arbitrary Drive file; the key must belong to one of the module's tests.
 */
export const maxDuration = 60;

export const POST = withTrainingAdmin<{ moduleId: string }>(async (request, { params }) => {
  const parsed = await readJsonBody(request, 1024);
  if (!parsed.ok) return parsed.response;
  const { key, driveId } = (parsed.body ?? {}) as { key?: unknown; driveId?: unknown };
  if (typeof key !== 'string' || typeof driveId !== 'string' || !/^[\w-]{10,80}$/.test(driveId)) {
    throw new TrainingError('Invalid request', 400);
  }
  if (!moduleMaterialKeys(params.moduleId).includes(key)) throw new TrainingError('That file is not part of this module', 400);

  return NextResponse.json(await syncFile(params.moduleId, key, driveId));
});
