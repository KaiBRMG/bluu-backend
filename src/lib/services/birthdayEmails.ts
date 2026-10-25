import 'server-only';
import { adminDb } from '@/lib/firebase-admin';
import { sendEmail } from '@/lib/email/resend';
import { birthdayEmail } from '@/lib/email/templates';

/**
 * The daily birthday email.
 *
 * `users/{uid}.DOB` is written by `/api/user/update` as `new Date('YYYY-MM-DD')`,
 * i.e. **UTC midnight** of the calendar date the user picked — so the birthday is
 * the DOB's UTC month/day, compared with today's UTC month/day. Using any local
 * zone would shift it by a day for half the fleet.
 *
 * A 29 February birthday is celebrated on 28 February in non-leap years.
 *
 * One query, no per-user reads (rule 9): nothing can index "month and day of a
 * timestamp", and the roster is a few dozen people, so the projected collection
 * is read once a day. Only active, unarchived people are mailed — an offboarded
 * address must never hear from us.
 *
 * Duplicate protection is Resend's idempotency key (`birthday/<uid>/<year>`,
 * honoured for 24h), which covers a cron retry; the schedule is once a day.
 */
const isLeapYear = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

export async function sendBirthdayEmails(now = new Date()): Promise<{ checked: number; sent: number; failed: number }> {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const day = now.getUTCDate();
  const feb28InCommonYear = month === 1 && day === 28 && !isLeapYear(year);

  const snap = await adminDb
    .collection('users')
    .select('DOB', 'workEmail', 'isActive', 'isArchived')
    .get();

  const email = birthdayEmail();
  let sent = 0;
  let failed = 0;

  for (const doc of snap.docs) {
    const u = doc.data();
    const dob = u.DOB?.toDate?.() as Date | undefined;
    if (!dob || !u.workEmail || u.isActive === false || u.isArchived === true) continue;

    const m = dob.getUTCMonth();
    const d = dob.getUTCDate();
    const isToday = (m === month && d === day) || (feb28InCommonYear && m === 1 && d === 29);
    if (!isToday) continue;

    try {
      await sendEmail({
        to: u.workEmail,
        subject: email.subject,
        html: email.html,
        text: email.text,
        idempotencyKey: `birthday/${doc.id}/${year}`,
        tags: [{ name: 'category', value: 'birthday' }],
      });
      sent++;
    } catch (error) {
      failed++;
      console.error(`[birthday-emails] failed for ${doc.id}:`, error);
    }
  }

  return { checked: snap.size, sent, failed };
}
