import { NextResponse } from 'next/server';
import { withCandidate } from '@/lib/middleware/withCandidate';
import { getDatasets } from '@/lib/services/trainingService';
import { DATASET_IDS, type DatasetId } from '@/lib/training/modules';
import { TrainingError } from '@/lib/training/errors';

/**
 * Candidate — the identity datasets, for the modal; only while the attempt runs.
 * `?identity=JOE` returns just that tab's images, so opening the modal does not
 * sign every dataset's every image (rule 9i).
 */
export const GET = withCandidate<{ moduleId: string; testId: string }>(async (request, { emailHash, params }) => {
  const raw = new URL(request.url).searchParams.get('identity');
  if (raw !== null && !DATASET_IDS.includes(raw as DatasetId)) throw new TrainingError('Invalid request', 400);
  return NextResponse.json(await getDatasets(emailHash, params.moduleId, params.testId, raw as DatasetId | null));
});
