/**
 * One-shot operational alerts for the OnlyFans media cache — server only.
 *
 * These are not user notifications in the usual sense. They report a **standing
 * condition someone has to go and fix** — a bucket that needs a lifecycle rule,
 * a provider change that has quietly switched off the largest cost saving in the
 * app — and they are addressed to one named operator rather than to a group.
 *
 * ## Why a single hardcoded uid
 *
 * The notification docs say to iterate `groups/admin.members` and never hardcode
 * a uid. That rule is about **fan-out**: a notification meant for all admins must
 * not silently reach only the one whose id someone typed. These are the opposite
 * — deliberately addressed to the person who maintains this subsystem, because
 * they name a Cloud Storage prefix and a regex constant. Broadcasting them to
 * every admin would be noise for everyone who cannot act on them.
 *
 * The uid is therefore a named, documented constant with exactly one definition,
 * not an id inlined at a call site. Change it here when ownership moves.
 *
 * ## Why "once ever"
 *
 * Both conditions persist until fixed, so a recurring alert would repeat a fact
 * the reader already has and train them to ignore it. Neither can un-fire on its
 * own, so there is nothing to re-notify about.
 */
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { addNotificationToBatch } from '@/lib/middleware/apiHelpers';
import { notifications, type NotificationContent } from '@/lib/notificationContent';
import { takeUnrecognisedVideoSourceHost } from '@/lib/onlyfans';

/**
 * Who receives the alerts in this file. One person, on purpose — see the module
 * note. This is the only place the id appears.
 */
export const OPS_ALERT_RECIPIENT_UID = 'VoRCp0wmgvSgKG8yzxOyMyZ4cSv1';

/**
 * The latch. Lives in `onlyfans-meta`, which Firestore rules already deny to
 * every client, so no rules change is needed — and it sits beside the sync
 * marker it is operationally related to.
 */
const LATCH_DOC = 'onlyfans-meta/ops-alerts';

/**
 * Send an alert the first time its condition is seen, and never again.
 *
 * Two independent guards, because they fail differently. The **latch document**
 * is what makes it once-ever: it survives lambdas, deploys and the recipient
 * dismissing the notification. The **deterministic doc id** is what makes it
 * once even if two instances read the latch in the same instant and both decide
 * to write — they write the same document rather than two.
 *
 * Returns whether it actually sent, for the caller's logs.
 */
export async function sendOpsAlertOnce(key: string, content: NotificationContent): Promise<boolean> {
  const latchRef = adminDb.doc(LATCH_DOC);

  const snapshot = await latchRef.get();
  if (snapshot.exists && snapshot.get(key)) return false;

  const batch = adminDb.batch();
  addNotificationToBatch(batch, OPS_ALERT_RECIPIENT_UID, content, {
    docId: `${OPS_ALERT_RECIPIENT_UID}__ops-${key}`,
  });
  batch.set(latchRef, { [key]: FieldValue.serverTimestamp() }, { merge: true });
  await batch.commit();

  console.info(`[onlyfans:ops] sent one-time alert "${key}"`);
  return true;
}

/**
 * Report that the provider is serving its video renditions from a host the
 * adapter will not accept — which means every video is falling back to the
 * source master and the single largest media saving is not applying.
 *
 * The adapter records the host and this drains it, so nothing above the provider
 * seam has to know what a legitimate media host looks like. Call it from
 * `after()` on a route that normalises messages: it must never sit in front of a
 * response, and it costs one Firestore read on the rare occasions it has
 * anything to do (the adapter's own once-per-process guard means it is usually
 * a no-op that touches nothing).
 *
 * Best-effort by construction — a diagnostic that broke a thread from loading
 * would be worse than the thing it diagnoses.
 */
export async function reportUnrecognisedVideoSourceHost(): Promise<void> {
  const host = takeUnrecognisedVideoSourceHost();
  if (!host) return;

  try {
    await sendOpsAlertOnce('video-source-host', notifications.ofVideoSourceHostUnrecognised(host));
  } catch (error) {
    console.error('[onlyfans:ops] could not report unrecognised video source host', error);
  }
}
