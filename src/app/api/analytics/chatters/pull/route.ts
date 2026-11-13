import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';

const RETIRED = 'BuddyX has been retired, so there is nothing to pull. Reload the app to update this page.';

/**
 * POST /api/analytics/chatters/pull — **compatibility stub, delete after 2026-11-30.**
 *
 * The "Pull" button fetched a custom range's reply-time medians from BuddyX.
 * BuddyX is retired and medians are no longer shown; a renderer loaded before
 * that can still press it (rule 9c), and shows this message as a toast.
 */
export const POST = withAuth(async () => NextResponse.json({ error: RETIRED }, { status: 410 }));
