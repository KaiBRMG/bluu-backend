import { NextResponse } from 'next/server';
import { readJsonBody } from '@/lib/middleware/apiHelpers';
import { withTrainingAdmin } from '@/lib/middleware/withTrainingAdmin';
import { addParticipants, revokeParticipant } from '@/lib/services/trainingService';
import { TrainingError } from '@/lib/training/errors';
import { isEmailHash } from '@/lib/training/model';

/**
 * Add or remove people (page permission `training`, `no-store`: writes).
 * Removing keeps the record and any submitted work — it only stops the
 * candidate getting in, and takes effect on their very next request (the cookie
 * is identity, not access). Adding a removed address restores them.
 */
export const POST = withTrainingAdmin<{ moduleId: string }>(async (request, { params }) => {
  const read = await readJsonBody(request, 64 * 1024);
  if (!read.ok) return read.response;
  const emails = (read.body as { emails?: unknown } | null)?.emails;
  return NextResponse.json(await addParticipants(params.moduleId, typeof emails === 'string' ? emails : ''));
});

export const DELETE = withTrainingAdmin<{ moduleId: string }>(async (request, { params }) => {
  const read = await readJsonBody(request, 1024);
  if (!read.ok) return read.response;
  const emailHash = (read.body as { emailHash?: unknown } | null)?.emailHash;
  if (!isEmailHash(emailHash)) {
    throw new TrainingError('Invalid request', 400);
  }
  await revokeParticipant(params.moduleId, emailHash);
  return NextResponse.json({ ok: true });
});
