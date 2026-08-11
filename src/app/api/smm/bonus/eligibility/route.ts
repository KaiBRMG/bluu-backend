import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { checkSmmAccess, checkViralEligibility } from '@/lib/services/smmService';
import { normalizePostLink } from '@/lib/smm/linkUtils';
import type { DecodedIdToken } from 'firebase-admin/auth';

/**
 * GET /api/smm/bonus/eligibility?link=URL
 * The viral-copy check shown while scheduling a post ("Did you copy another
 * viral post?"). Advisory only — POST /api/smm/posts re-runs the same check
 * server-side before storing the copy declaration.
 */
export const GET = withAuth(async (request: NextRequest, token: DecodedIdToken) => {
  try {
    const denied = await checkSmmAccess(token.uid, 'dashboard');
    if (denied) return denied;

    const link = request.nextUrl.searchParams.get('link') ?? '';
    const normalized = normalizePostLink(link);
    if (!normalized) {
      return NextResponse.json({ error: 'A link is required' }, { status: 400 });
    }

    return NextResponse.json(await checkViralEligibility(normalized));
  } catch (error) {
    console.error('[GET /api/smm/bonus/eligibility]', error);
    return NextResponse.json({ error: 'Failed to check eligibility' }, { status: 500 });
  }
});
