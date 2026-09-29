import { NextRequest, NextResponse } from 'next/server';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { withAuth } from '@/lib/middleware/withAuth';
import { checkPageAccess, handleApiError } from '@/lib/middleware/apiHelpers';
import { listOnboardings } from '@/lib/services/creatorOnboardingService';

/**
 * The staff Onboarding page's list. Summaries only — the Firestore read is
 * projected with `select()`, so no applicant's answers travel until someone
 * opens that applicant (rule 9i: return only what the caller renders).
 *
 * Per-user and live (a completed form should appear on the next load), so the
 * only cache available is the browser's, and it is not worth the staleness:
 * no Cache-Control.
 */
export const GET = withAuth(async (_request: NextRequest, token: DecodedIdToken) => {
  const denied = await checkPageAccess(token.uid, 'creators-onboarding');
  if (denied) return denied;
  try {
    return NextResponse.json({ onboardings: await listOnboardings() });
  } catch (error) {
    return handleApiError(error, 'creator-onboarding GET');
  }
});
