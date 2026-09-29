import { NextRequest, NextResponse } from 'next/server';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { withAuth } from '@/lib/middleware/withAuth';
import { checkPageAccess, handleApiError } from '@/lib/middleware/apiHelpers';
import { getOnboardingDetail } from '@/lib/services/creatorOnboardingService';

/** One applicant's full onboarding answers. Page permission; not cacheable (PII). */
export const GET = withAuth<{ id: string }>(async (_request: NextRequest, token: DecodedIdToken, params) => {
  const denied = await checkPageAccess(token.uid, 'creators-onboarding');
  if (denied) return denied;
  try {
    const { id } = await params;
    const detail = await getOnboardingDetail(id);
    if (!detail) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ onboarding: detail });
  } catch (error) {
    return handleApiError(error, 'creator-onboarding/[id] GET');
  }
});
