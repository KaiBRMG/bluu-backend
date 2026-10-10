/**
 * GET /api/analytics/chatters/[uid]/shift?start=ms&end=ms&scheduled=1 — one
 * shift at minute grain for the report's timeline: Bluu state, BuddyX online
 * per hour, keys per minute, flagged stretches, and the captures.
 *
 * **`ca-admin` only.** Screenshot thumbnails are included only for a viewer who
 * could already open this person's screenshots (the admin claim or the
 * `shift-management` page) — the report must not widen that access (rule 10).
 */
import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { checkPageAccess, handleApiError } from '@/lib/middleware/apiHelpers';
import { analyticsAccess, ANALYTICS_CACHE_HEADERS } from '@/lib/buddyx/analyticsAuth';
import { getShiftDetail } from '@/lib/services/chatterIntegrityService';
import type { DecodedIdToken } from 'firebase-admin/auth';

const MAX_SPAN_MS = 24 * 3_600_000;

export const GET = withAuth<{ uid: string }>(async (request: NextRequest, token: DecodedIdToken, params) => {
  try {
    const access = await analyticsAccess(token, 'ca-chatter-analytics');
    if (access instanceof NextResponse) return access;
    if (!access.isAdmin) return NextResponse.json({ error: 'Reports are for CA admins' }, { status: 403 });

    const { uid } = await params;
    const { searchParams } = new URL(request.url);
    const start = Number(searchParams.get('start'));
    const end = Number(searchParams.get('end'));
    if (!uid || !Number.isFinite(start) || !Number.isFinite(end) || end <= start || end - start > MAX_SPAN_MS) {
      return NextResponse.json({ error: 'start and end (ms) are required, at most 24h apart' }, { status: 400 });
    }

    const canViewScreenshots = token.admin === true || (await checkPageAccess(token.uid, 'shift-management')) === null;
    const detail = await getShiftDetail({
      uid,
      startMs: start,
      endMs: end,
      scheduled: searchParams.get('scheduled') === '1',
      canViewScreenshots,
    });
    // Signed thumbnail URLs live an hour; a minute of browser cache is well inside that.
    return NextResponse.json(detail, { headers: ANALYTICS_CACHE_HEADERS });
  } catch (err) {
    return handleApiError(err, 'analytics/chatters/[uid]/shift GET');
  }
});
