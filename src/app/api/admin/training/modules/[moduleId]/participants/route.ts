import { after, NextResponse } from 'next/server';
import { sendEmail } from '@/lib/email/resend';
import { trainingInviteEmail } from '@/lib/email/templates';
import { readJsonBody } from '@/lib/middleware/apiHelpers';
import { withTrainingAdmin } from '@/lib/middleware/withTrainingAdmin';
import { addParticipants, revokeParticipant } from '@/lib/services/trainingService';
import { TrainingError } from '@/lib/training/errors';
import { getModule } from '@/lib/training/modules';
import { isEmailHash } from '@/lib/training/model';

/**
 * Add or remove people (page permission `training`, `no-store`: writes).
 * Removing keeps the record and any submitted work — it only stops the
 * candidate getting in, and takes effect on their very next request (the cookie
 * is identity, not access). Adding a removed address restores them.
 *
 * A NEW address on a module that is on is emailed an invitation naming the module
 * (best-effort, in `after()`: a Resend failure never fails the add). Restores are
 * not re-invited, and nobody is while the module is off — they could not sign in.
 */
export const POST = withTrainingAdmin<{ moduleId: string }>(async (request, { params }) => {
  const read = await readJsonBody(request, 64 * 1024);
  if (!read.ok) return read.response;
  const emails = (read.body as { emails?: unknown } | null)?.emails;
  const { added, invitees, held } = await addParticipants(params.moduleId, typeof emails === 'string' ? emails : '');
  const moduleTitle = getModule(params.moduleId)?.title;
  if (moduleTitle && invitees.length > 0) {
    after(async () => {
      const email = trainingInviteEmail(moduleTitle);
      for (const to of invitees) {
        try {
          await sendEmail({ to, email, tags: [{ name: 'kind', value: 'training-invite' }] });
        } catch (error) {
          console.error('[training/invite]', error);
        }
      }
    });
  }
  return NextResponse.json({ added, invited: invitees.length, held });
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
