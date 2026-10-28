import { NextResponse } from 'next/server';
import { withTrainingAdmin } from '@/lib/middleware/withTrainingAdmin';
import { deleteRecording, getRecording } from '@/lib/services/trainingService';
import { TrainingError } from '@/lib/training/errors';

/**
 * One candidate's screen recording of one part (page permission `training`).
 * `?part=<partId>` is required. GET lists the segments with signed read URLs;
 * `&after=<seq>` returns only newer ones, which is how the live view polls.
 * DELETE removes the recording (refused while the part is running).
 */
export const GET = withTrainingAdmin<{ sessionId: string; emailHash: string }>(async (request, { params }) => {
  const url = new URL(request.url);
  const partId = url.searchParams.get('part') ?? '';
  const rawAfter = url.searchParams.get('after');
  const after = rawAfter === null ? null : Number(rawAfter);
  if (after !== null && !(Number.isInteger(after) && after >= 0)) throw new TrainingError('Invalid request', 400);
  return NextResponse.json(await getRecording(params.sessionId, params.emailHash, partId, after));
});

export const DELETE = withTrainingAdmin<{ sessionId: string; emailHash: string }>(async (request, { params }) => {
  const partId = new URL(request.url).searchParams.get('part') ?? '';
  await deleteRecording(params.sessionId, params.emailHash, partId);
  return NextResponse.json({ ok: true });
});
