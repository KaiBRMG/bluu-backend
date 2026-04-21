import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/lib/firebase-admin';
import type { DecodedIdToken } from 'firebase-admin/auth';

/**
 * Wraps a route handler with Firebase token verification for creator portal API routes.
 * Verifies the Bearer token, checks the user exists in the creators collection
 * and is active, then passes the decoded token to the handler.
 * Returns 401 for missing/invalid tokens and 403 for non-creator or inactive accounts.
 */
export function withCreatorAuth(
  handler: (req: NextRequest, token: DecodedIdToken) => Promise<NextResponse>
): (req: NextRequest) => Promise<NextResponse>;

export function withCreatorAuth<TParams>(
  handler: (req: NextRequest, token: DecodedIdToken, params: Promise<TParams>) => Promise<NextResponse>
): (req: NextRequest, context: { params: Promise<TParams> }) => Promise<NextResponse>;

export function withCreatorAuth(handler: Function) {
  return async (req: NextRequest, context?: { params: unknown }) => {
    const authHeader = req.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Missing authorization token' }, { status: 401 });
    }

    const idToken = authHeader.slice(7);

    let token: DecodedIdToken;
    try {
      token = await adminAuth.verifyIdToken(idToken);
    } catch (error: unknown) {
      const code = (error as { code?: string })?.code;
      if (code === 'auth/id-token-expired') {
        return NextResponse.json({ error: 'Session expired' }, { status: 401 });
      }
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    // Verify the user is an active creator
    const creatorDoc = await adminDb.collection('creators').doc(token.uid).get();
    if (!creatorDoc.exists) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }
    if (creatorDoc.data()?.isActive === false) {
      return NextResponse.json({ error: 'Account is inactive' }, { status: 403 });
    }

    return context !== undefined
      ? handler(req, token, context.params)
      : handler(req, token);
  };
}
