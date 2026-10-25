import { NextResponse } from 'next/server';
import { readJsonBody } from '@/lib/middleware/apiHelpers';
import { withTrainingAdmin } from '@/lib/middleware/withTrainingAdmin';
import { addParticipants, revokeParticipant } from '@/lib/services/trainingService';
import { TrainingError } from '@/lib/training/errors';

/**
 * Add or revoke participants (page permission `training`, `no-store`: writes).
 * Revoking keeps the record and any submitted work — it only stops the
 * candidate getting in, and takes effect on their very next request (the cookie
 * is identity, not access).
 */
export const POST = withTrainingAdmin<{ sessionId: string }>(async (request, { params }) => {
  const read = await readJsonBody(request, 64 * 1024);
  if (!read.ok) return read.response;
  const emails = (read.body as { emails?: unknown } | null)?.emails;
  return NextResponse.json(await addParticipants(params.sessionId, typeof emails === 'string' ? emails : ''));
});

export const DELETE = withTrainingAdmin<{ sessionId: string }>(async (request, { params }) => {
  const read = await readJsonBody(request, 1024);
  if (!read.ok) return read.response;
  const emailHash = (read.body as { emailHash?: unknown } | null)?.emailHash;
  if (typeof emailHash !== 'string' || !/^[a-f0-9]{32}$/.test(emailHash)) {
    throw new TrainingError('Invalid request', 400);
  }
  await revokeParticipant(params.sessionId, emailHash);
  return NextResponse.json({ ok: true });
});
