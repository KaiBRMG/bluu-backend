import { NextResponse } from 'next/server';
import { withCandidate } from '@/lib/middleware/withCandidate';
import { readJsonBody } from '@/lib/middleware/apiHelpers';
import { saveText } from '@/lib/services/trainingService';
import { MAX_TEXT_LENGTH } from '@/lib/training/modules';
import { TrainingError } from '@/lib/training/errors';

/** Candidate — autosave the task record. Last write wins; throttled server-side. */
export const PUT = withCandidate<{ moduleId: string; testId: string }>(async (request, { emailHash, params }) => {
  const read = await readJsonBody(request, MAX_TEXT_LENGTH * 4 + 1024);
  if (!read.ok) return read.response;
  const text = (read.body as { text?: unknown } | null)?.text;
  if (typeof text !== 'string') throw new TrainingError('Invalid request', 400);
  await saveText(emailHash, params.moduleId, params.testId, text);
  return NextResponse.json({ ok: true, savedAtMs: Date.now() });
});
