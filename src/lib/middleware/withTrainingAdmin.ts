import { NextRequest, NextResponse } from 'next/server';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { withAuth } from '@/lib/middleware/withAuth';
import { checkPageAccess } from '@/lib/middleware/apiHelpers';
import { TrainingError } from '@/lib/training/errors';

/**
 * Guard for the admin training API: an employee (`withAuth`) holding the
 * `training` page permission (tier 2 — a candidate is not part of the employee
 * auth graph, so these routes grant no account and change no claim).
 *
 * It owns the three things every route here would otherwise repeat, and that
 * one forgotten copy would silently drop: the permission check, the
 * `TrainingError` → status mapping, and `Cache-Control: no-store` (admin views
 * show a clock-driven state and freshly signed URLs, and every other call is a
 * write).
 */
export function withTrainingAdmin<P = Record<string, never>>(
  handler: (request: NextRequest, ctx: { token: DecodedIdToken; params: P }) => Promise<NextResponse>,
) {
  return withAuth<P>(async (request: NextRequest, token: DecodedIdToken, params: Promise<P>) => {
    const denied = await checkPageAccess(token.uid, 'training');
    if (denied) return denied;

    let response: NextResponse;
    try {
      response = await handler(request, { token, params: await params });
    } catch (error) {
      if (error instanceof TrainingError) {
        response = NextResponse.json({ error: error.message }, { status: error.status });
      } else {
        console.error('[admin/training]', error);
        response = NextResponse.json({ error: 'Internal server error' }, { status: 500 });
      }
    }
    response.headers.set('Cache-Control', 'no-store');
    return response;
  });
}
