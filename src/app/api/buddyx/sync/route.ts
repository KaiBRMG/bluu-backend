import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';

const RETIRED = 'BuddyX has been retired. Data now comes from OnlyMonster, three times a day. Reload the app to update this page.';

/**
 * POST /api/buddyx/sync — **compatibility stub, delete after 2026-11-30.**
 *
 * BuddyX is retired. A renderer loaded before that can still press its refresh
 * button (rule 9c); the old hook shows this message as a toast. `410 Gone`.
 */
export const POST = withAuth(async () => NextResponse.json({ error: RETIRED }, { status: 410 }));
