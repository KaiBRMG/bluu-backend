import { NextRequest, NextResponse } from 'next/server';
import {
  clientIp,
  consumeRate,
  createSession,
  hashIp,
} from '@/lib/services/modelSubmissionService';

/**
 * PUBLIC — issues a signed, single-use submission session.
 *
 * Every other public model-submission endpoint requires the `{ sessionId,
 * token }` pair this returns, so a script cannot POST straight at the upload or
 * submit routes. Sessions are rate limited per IP, expire, and can be spent
 * exactly once.
 */
export async function POST(request: NextRequest) {
  try {
    const ipHash = hashIp(clientIp(request.headers));

    if (!(await consumeRate(ipHash, 'sessions'))) {
      return NextResponse.json(
        { error: 'Too many applications started from this connection. Try again tomorrow.' },
        { status: 429 },
      );
    }

    const { sessionId, token } = await createSession(ipHash);
    return NextResponse.json({ sessionId, token });
  } catch (error) {
    console.error('[model-submissions/session]', error);
    return NextResponse.json({ error: 'Could not start the form. Please refresh.' }, { status: 500 });
  }
}
