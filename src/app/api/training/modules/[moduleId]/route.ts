import { NextResponse } from 'next/server';
import { withCandidate } from '@/lib/middleware/withCandidate';
import { getModuleForCandidate } from '@/lib/services/trainingService';

/**
 * Candidate — one module for `/training/<module>`: its tests and where each
 * stands for this person. 404 when the module is off or they are not on it —
 * the page treats both as "training isn't running". `no-store` via `withCandidate`.
 * The page polls this every 15 s while it waits for a test to open, so it reads
 * two documents and nothing else.
 */
export const GET = withCandidate<{ moduleId: string }>(async (_request, { emailHash, params }) => {
  return NextResponse.json(await getModuleForCandidate(emailHash, params.moduleId));
});
