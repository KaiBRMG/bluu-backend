import { NextRequest, NextResponse } from 'next/server';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { withAuth } from '@/lib/middleware/withAuth';
import { checkPageAccess, handleApiError } from '@/lib/middleware/apiHelpers';
import { replyManually } from '@/lib/services/creatorInquiryService';

/**
 * Sends the standard enquiry reply by hand — for mail the filter held, flagged
 * as spam, or failed to send. Refuses a second reply to the same email; the
 * Resend idempotency key (`inquiry-reply/<id>`) backs that up for a double tap.
 */
export const POST = withAuth<{ id: string }>(async (_request: NextRequest, token: DecodedIdToken, params) => {
  const denied = await checkPageAccess(token.uid, 'creators-onboarding');
  if (denied) return denied;
  try {
    const { id } = await params;
    if (!/^[A-Za-z0-9-]{8,64}$/.test(id)) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    }
    const result = await replyManually(id, token.uid);
    if (result === 'not-found') return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (result === 'no-address') return NextResponse.json({ error: 'No reply address on this email' }, { status: 409 });
    if (result === 'already') return NextResponse.json({ error: 'Already replied' }, { status: 409 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleApiError(error, 'creator-inquiries/[id]/reply');
  }
});
