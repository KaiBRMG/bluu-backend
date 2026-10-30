import { NextRequest, NextResponse } from 'next/server';
import { readCandidate } from '@/lib/services/trainingAuthService';
import { TrainingError } from '@/lib/training/errors';

/**
 * Guard for the candidate-facing training API — the analogue of `withAuth` for
 * a person who is neither an employee nor a creator.
 *
 * It verifies the signed cookie and nothing more. The cookie is an IDENTITY (an
 * email hash); whether that identity may touch a given session is re-derived
 * from Firestore inside each service call, so a revoked participant or a closed
 * session is refused immediately.
 *
 * Every response is `no-store`: these are per-person and, for the part routes,
 * time-sensitive. A `TrainingError` becomes its own status and message; anything
 * else is a generic 500.
 */
export function withCandidate<P = Record<string, never>>(
  handler: (request: NextRequest, ctx: { emailHash: string; params: P }) => Promise<NextResponse>,
) {
  return async (request: NextRequest, context: { params: Promise<P> }): Promise<NextResponse> => {
    const emailHash = readCandidate(request);
    let response: NextResponse;
    if (!emailHash) {
      response = NextResponse.json({ error: 'Please sign in again' }, { status: 401 });
    } else {
      try {
        response = await handler(request, { emailHash, params: await context.params });
      } catch (error) {
        if (error instanceof TrainingError) {
          response = NextResponse.json(
            { error: error.message, ...(error.code ? { code: error.code } : {}) },
            { status: error.status },
          );
        } else {
          console.error('[training]', error);
          response = NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 });
        }
      }
    }
    response.headers.set('Cache-Control', 'no-store');
    return response;
  };
}
