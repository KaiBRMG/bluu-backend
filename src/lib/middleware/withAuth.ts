import { NextRequest, NextResponse } from 'next/server';
import { adminAuth } from '@/lib/firebase-admin';
import type { DecodedIdToken } from 'firebase-admin/auth';

export type AuthedHandler<TParams = undefined> = TParams extends undefined
  ? (req: NextRequest, token: DecodedIdToken) => Promise<NextResponse>
  : (req: NextRequest, token: DecodedIdToken, params: TParams) => Promise<NextResponse>;

/**
 * Wraps a route handler with Firebase token verification.
 * Extracts the Bearer token, verifies it, and passes the decoded token to the handler.
 * Returns 401 if the token is missing, invalid, or expired.
 */
export function withAuth(
  handler: (req: NextRequest, token: DecodedIdToken) => Promise<NextResponse>
): (req: NextRequest) => Promise<NextResponse>;

export function withAuth<TParams>(
  handler: (req: NextRequest, token: DecodedIdToken, params: TParams) => Promise<NextResponse>
): (req: NextRequest, context: { params: TParams }) => Promise<NextResponse>;

export function withAuth(handler: Function) {
  return async (req: NextRequest, context?: { params: unknown }) => {
    const authHeader = req.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Missing authorization token' }, { status: 401 });
    }

    const idToken = authHeader.slice(7);

    try {
      const token = await adminAuth.verifyIdToken(idToken);
      return context !== undefined
        ? handler(req, token, context.params)
        : handler(req, token);
    } catch (error: unknown) {
      const code = (error as { code?: string })?.code;
      if (code === 'auth/id-token-expired') {
        return NextResponse.json({ error: 'Session expired' }, { status: 401 });
      }
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }
  };
}
