/**
 * POST /api/analytics/chatters/pull `{ from, to }` — one live team overview for
 * a custom range, stored for 7 days (`ca-admin`).
 *
 * Medians and p75s cannot be summed from days, so a custom range renders them
 * as "—" until an admin pulls the whole range at once. This is the only BuddyX
 * call a page makes outside a sync, and it is one request on the expensive
 * bucket, behind a person pressing a button.
 */
import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { handleApiError, readJsonBody } from '@/lib/middleware/apiHelpers';
import { requireCaAdmin } from '@/lib/salary/salaryAuth';
import { isBuddyxConfigured } from '@/lib/buddyx/client';
import { isBuddyxError } from '@/lib/buddyx/errors';
import { isDayKey } from '@/lib/salary/salaryDate';
import { loadBuddyxMaps } from '@/lib/services/buddyxMappingService';
import { pullCustomTeamPeriod } from '@/lib/services/buddyxStatsSync';
import type { DecodedIdToken } from 'firebase-admin/auth';

export const POST = withAuth(async (request: NextRequest, token: DecodedIdToken) => {
  try {
    const denied = await requireCaAdmin(token);
    if (denied) return denied;
    if (!isBuddyxConfigured()) {
      return NextResponse.json({ error: 'BuddyX is not configured on this deployment.' }, { status: 503 });
    }

    const parsed = await readJsonBody(request, 256);
    if (!parsed.ok) return parsed.response;
    const { from, to } = parsed.body as { from?: unknown; to?: unknown };
    if (!isDayKey(from) || !isDayKey(to) || from > to) {
      return NextResponse.json({ error: 'from ≤ to (YYYY-MM-DD) are required.' }, { status: 400 });
    }
    if ((Date.parse(to) - Date.parse(from)) / 86_400_000 + 1 > 92) {
      return NextResponse.json({ error: 'A custom range can span at most 92 days.' }, { status: 400 });
    }

    try {
      await pullCustomTeamPeriod(await loadBuddyxMaps(), from, to);
    } catch (err) {
      if (isBuddyxError(err)) return NextResponse.json({ error: `BuddyX: ${err.message}` }, { status: 502 });
      throw err;
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    return handleApiError(err, 'analytics/chatters/pull POST');
  }
});
