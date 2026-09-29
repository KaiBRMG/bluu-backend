import { NextRequest, NextResponse } from 'next/server';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { withAuth } from '@/lib/middleware/withAuth';
import { checkPageAccess, handleApiError } from '@/lib/middleware/apiHelpers';
import { listInquiries } from '@/lib/services/creatorInquiryService';

/**
 * The Inbox tab: every email hello@ received and what the filter did with it.
 * Gated on the Onboarding page — the same people who work the funnel.
 * Not cacheable: a held enquiry must appear on the next load.
 */
export const GET = withAuth(async (_request: NextRequest, token: DecodedIdToken) => {
  const denied = await checkPageAccess(token.uid, 'creators-onboarding');
  if (denied) return denied;
  try {
    return NextResponse.json({ inquiries: await listInquiries() });
  } catch (error) {
    return handleApiError(error, 'creator-inquiries GET');
  }
});
