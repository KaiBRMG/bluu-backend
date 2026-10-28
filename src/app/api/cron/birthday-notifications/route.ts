import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { handleApiError } from '@/lib/middleware/apiHelpers';
import { sendBirthdayNotifications } from '@/lib/services/birthdayNotifications';

/**
 * GET /api/cron/birthday-notifications — the daily staff birthday notification
 * (08:00 UTC), in the app and on Telegram.
 *
 * Lives here rather than in `functions/` because scheduled work that sends a
 * notification belongs in `src` (copy lives only in `notificationContent.ts`).
 * Cache-Control: not applicable — a cron endpoint, called only by Vercel.
 */
export async function GET() {
  const authorization = (await headers()).get('authorization');

  // Fail closed when CRON_SECRET is unset.
  const secret = process.env.CRON_SECRET;
  if (!secret || authorization !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await sendBirthdayNotifications();
    if (result.notified) console.log(`[birthday-notifications] notified ${result.notified}`);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    return handleApiError(error, 'GET /api/cron/birthday-notifications');
  }
}
