import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { handleApiError } from '@/lib/middleware/apiHelpers';
import { sendBirthdayEmails } from '@/lib/services/birthdayEmails';

/**
 * GET /api/cron/birthday-emails — the daily staff birthday email (08:00 UTC).
 *
 * Lives here rather than in `functions/` because it uses the Resend client and
 * the email templates in `src/lib`. Cache-Control: not applicable — a cron
 * endpoint, called only by Vercel.
 */
export async function GET() {
  const authorization = (await headers()).get('authorization');

  // Fail closed when CRON_SECRET is unset: this sends email on our domain.
  const secret = process.env.CRON_SECRET;
  if (!secret || authorization !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await sendBirthdayEmails();
    if (result.sent || result.failed) {
      console.log(`[birthday-emails] sent ${result.sent}, failed ${result.failed}`);
    }
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    return handleApiError(error, 'GET /api/cron/birthday-emails');
  }
}
