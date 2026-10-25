import { NextResponse } from 'next/server';
import { withCandidate } from '@/lib/middleware/withCandidate';
import { getMe, pickSession } from '@/lib/services/trainingService';
import { TrainingError } from '@/lib/training/errors';
import { getModule } from '@/lib/training/modules';

/**
 * Candidate — the sitting to show on `/training/<module>`.
 *
 * The page URL carries no session id, so the server resolves it: the sitting
 * named in `?session=` if the candidate is on it, otherwise the one most worth
 * showing (see `pickSession`). `no-store` via `withCandidate`.
 */
export const GET = withCandidate<{ moduleId: string }>(async (request, { emailHash, params }) => {
  if (!getModule(params.moduleId)) throw new TrainingError('Not found', 404);
  const me = await getMe(emailHash);
  const session = pickSession(me.sessions, params.moduleId, new URL(request.url).searchParams.get('session'));
  if (!session) throw new TrainingError('Not found', 404);
  return NextResponse.json({ nowMs: me.nowMs, name: me.name, session });
});
