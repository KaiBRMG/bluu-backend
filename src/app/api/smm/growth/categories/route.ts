import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { handleApiError, readJsonBody } from '@/lib/middleware/apiHelpers';
import { checkGrowthAccess } from '@/lib/services/growthTrackingService';
import { CategoryInputError, createCategory } from '@/lib/services/growthCategoryService';
import type { DecodedIdToken } from 'firebase-admin/auth';

/**
 * POST /api/smm/growth/categories — create an account category.
 *
 * Body: `{ name, platforms: ('twitter' | 'facebook')[], tone }`. Same single
 * access tier as the rest of Growth Tracking: anyone who may file an account may
 * create the grouping to file it under (rule 3 — this touches nothing in the
 * auth graph). Every field is validated server-side; the dialog's checks are an
 * affordance, not the rule (rule 10).
 *
 * Returns the new definition **and** the whole merged list, so the client can
 * replace its registry in one step instead of re-reading the roster payload.
 *
 * Uncacheable (rule 9i): it is a write.
 */
export const POST = withAuth(async (request: NextRequest, token: DecodedIdToken) => {
  try {
    const denied = await checkGrowthAccess(token.uid);
    if (denied) return denied;

    // Three short fields — 2 KB is generous, and anything larger is not a category.
    const parsed = await readJsonBody(request, 2_048);
    if (!parsed.ok) return parsed.response;

    const result = await createCategory(
      (parsed.body ?? {}) as { name?: unknown; platforms?: unknown; tone?: unknown },
      token.uid,
    );
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof CategoryInputError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return handleApiError(error, 'POST /api/smm/growth/categories');
  }
});
