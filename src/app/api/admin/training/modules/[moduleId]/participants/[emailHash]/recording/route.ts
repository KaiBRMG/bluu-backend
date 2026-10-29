import { NextResponse } from 'next/server';
import { withTrainingAdmin } from '@/lib/middleware/withTrainingAdmin';
import { deleteRecording, getRecording } from '@/lib/services/trainingRecordingService';
import { TrainingError } from '@/lib/training/errors';

/**
 * One candidate's screen recording of one test (page permission `training`).
 * `?test=<testId>` is required. GET lists the segments with signed read URLs;
 * `&after=<seq>` returns only newer ones, which is how the live view polls.
 * DELETE removes the recording (refused while the test is running).
 */
export const GET = withTrainingAdmin<{ moduleId: string; emailHash: string }>(async (request, { params }) => {
  const url = new URL(request.url);
  const testId = url.searchParams.get('test') ?? '';
  const rawAfter = url.searchParams.get('after');
  const after = rawAfter === null ? null : Number(rawAfter);
  if (after !== null && !(Number.isInteger(after) && after >= 0)) throw new TrainingError('Invalid request', 400);
  return NextResponse.json(await getRecording(params.moduleId, params.emailHash, testId, after));
});

export const DELETE = withTrainingAdmin<{ moduleId: string; emailHash: string }>(async (request, { params }) => {
  const testId = new URL(request.url).searchParams.get('test') ?? '';
  await deleteRecording(params.moduleId, params.emailHash, testId);
  return NextResponse.json({ ok: true });
});
