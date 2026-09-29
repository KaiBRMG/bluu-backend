import 'server-only';
import { adminDb } from '@/lib/firebase-admin';
import { addNotificationToBatch } from '@/lib/middleware/apiHelpers';
import type { NotificationContent } from '@/lib/notificationContent';
import { sendTelegramNotification } from '@/lib/services/telegramService';

/**
 * Notifies everyone who holds a page permission — in the app and on Telegram.
 * The page is the audience: whoever can act on the record is who hears of it.
 * Returns how many users were notified.
 */
export async function notifyPageHolders(pageId: string, content: NotificationContent): Promise<number> {
  const holders = await adminDb
    .collection('users')
    .where('permittedPageIds', 'array-contains', pageId)
    .select()
    .get();
  const uids = holders.docs.map((d) => d.id);
  if (uids.length === 0) return 0;
  const batch = adminDb.batch();
  for (const uid of uids) addNotificationToBatch(batch, uid, content);
  await Promise.all([batch.commit(), sendTelegramNotification(uids, content)]);
  return uids.length;
}
