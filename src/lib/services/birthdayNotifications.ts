import 'server-only';
import { adminDb } from '@/lib/firebase-admin';
import { addNotificationToBatch } from '@/lib/middleware/apiHelpers';
import { notifications } from '@/lib/notificationContent';
import { sendTelegramNotification } from '@/lib/services/telegramService';

/**
 * The daily staff birthday notification — in the app and on Telegram.
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
 * is read once a day. Only active, unarchived people are notified.
 *
 * Duplicate protection is the deterministic notification id
 * (`birthday-<uid>-<year>`): a cron retry rewrites the same doc rather than
 * adding a second. Telegram goes out after the commit, per notifications.md.
 */
const isLeapYear = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/** First word of the display name, or null when there is none to greet. */
function firstName(displayName: unknown): string | null {
  const first = typeof displayName === 'string' ? displayName.trim().split(/\s+/)[0] : '';
  return first || null;
}

export async function sendBirthdayNotifications(now = new Date()): Promise<{ checked: number; notified: number }> {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const day = now.getUTCDate();
  const feb28InCommonYear = month === 1 && day === 28 && !isLeapYear(year);

  const snap = await adminDb
    .collection('users')
    .select('DOB', 'isActive', 'isArchived', 'displayName')
    .get();

  const today = snap.docs.filter((doc) => {
    const u = doc.data();
    const dob = u.DOB?.toDate?.() as Date | undefined;
    if (!dob || u.isActive === false || u.isArchived === true) return false;
    const m = dob.getUTCMonth();
    const d = dob.getUTCDate();
    return (m === month && d === day) || (feb28InCommonYear && m === 1 && d === 29);
  });
  if (today.length === 0) return { checked: snap.size, notified: 0 };

  const batch = adminDb.batch();
  const sends = today.map((doc) => {
    const content = notifications.staffBirthday(firstName(doc.data().displayName));
    addNotificationToBatch(batch, doc.id, content, { docId: `birthday-${doc.id}-${year}` });
    return { uid: doc.id, content };
  });
  await batch.commit();
  await Promise.all(sends.map(({ uid, content }) => sendTelegramNotification([uid], content)));

  return { checked: snap.size, notified: sends.length };
}
