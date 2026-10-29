import { NextResponse } from 'next/server';
import { withCandidate } from '@/lib/middleware/withCandidate';
import { readJsonBody } from '@/lib/middleware/apiHelpers';
import { setIdentity } from '@/lib/services/trainingService';
import { DATASET_IDS, type DatasetId } from '@/lib/training/modules';
import { TrainingError } from '@/lib/training/errors';

/** Candidate — T4: choose which identity a slot uses. Choosing one already in use swaps the two. */
export const POST = withCandidate<{ moduleId: string; testId: string }>(async (request, { emailHash, params }) => {
  const read = await readJsonBody(request, 512);
  if (!read.ok) return read.response;
  const b = (read.body ?? {}) as { slotId?: unknown; identity?: unknown };
  if (typeof b.slotId !== 'string' || !DATASET_IDS.includes(b.identity as DatasetId)) {
    throw new TrainingError('Invalid request', 400);
  }
  const choices = await setIdentity(emailHash, params.moduleId, params.testId, b.slotId, b.identity as DatasetId);
  return NextResponse.json({ choices });
});
