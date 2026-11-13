import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';

/**
 * GET /api/buddyx/status — **compatibility stub, delete after 2026-11-30.**
 *
 * BuddyX is retired. A renderer loaded before that still polls here for its
 * page headers (rule 9c); this answers "not configured" in the shape it reads,
 * so the header says "BuddyX not connected" and disables its refresh button
 * instead of throwing. No reads.
 */
export const GET = withAuth(async () =>
  NextResponse.json(
    { configured: false, scopes: {}, running: null, salesWriteEnabled: false },
    { headers: { 'Cache-Control': 'private, max-age=3600', Vary: 'Authorization' } },
  ),
);
