import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { adminDb } from '@/lib/firebase-admin';
import { getUserById, invalidateUserCache } from '@/lib/services/userService';
import { isValidTimezone, timezoneFromRequest } from '@/lib/timezone';
import { getOffsetForTimezone } from '@/lib/timezoneData';
import { FieldValue } from 'firebase-admin/firestore';
import type { DecodedIdToken } from 'firebase-admin/auth';

/**
 * POST /api/user/timezone
 *
 * Sets `users/{uid}.timezone` from the caller's IP, so nobody has to fill in an
 * address before the app can show them their own clock.
 *
 * ## Why the IP and not the address
 *
 * The timezone used to be derived from the country typed into Personal
 * Information, through a hand-maintained country → zone map. That map only
 * covered ~60 countries, resolved a whole country to one zone (every US
 * employee became `America/New_York`), and — worst of it — meant a user who
 * never opened Settings had **no** timezone at all and silently read every time
 * in the product in UTC. Vercel's Edge Network already tags each request with
 * `x-vercel-ip-timezone`, a real IANA zone, for free. See `timezoneFromRequest`.
 *
 * ## Who wins
 *
 * A **manual** choice in App Settings is final: that write stamps
 * `timezoneSource: 'manual'` and this route refuses to touch the zone
 * afterwards. Detection only ever moves a timezone that is unset, invalid, or
 * was itself detected — which is also what makes travel work, since a relocated
 * user's next ping simply re-detects.
 *
 * A VPN is the known false positive, and it is a deliberate trade: an
 * `'auto'` zone is one click in Settings away from being `'manual'` and
 * permanent, whereas the status quo it replaces was UTC for everybody who never
 * went looking.
 *
 * ## Cost (rules 9 and 9i)
 *
 *  • The client only calls this on window mount and on a slow interval, and
 *    never at all once the user has chosen manually — see `TimezoneReporter`.
 *  • The read is {@link getUserById}, which is cached for 60s, and
 *    {@link lastCheckByUid} collapses the duplicate calls from a user running
 *    the main window alongside the satellites.
 *  • **Writes only on a real change.** Steady state — the overwhelming majority
 *    of calls — is one cached read and no write at all.
 *  • `timezoneSource` and `timezoneDetectedAt` are exempt from single-field
 *    indexing in `firestore.indexes.json`; nothing queries either.
 *
 * Machine-reported, so like `/api/user/presence` and `/api/user/app-version`
 * this is deliberately its own route rather than a `/api/user/update` field —
 * a client may declare a zone *manual*, but it may not declare one *detected*.
 */

/** One detection pass per user per this window, per server instance. */
const MIN_CHECK_GAP_MS = 30 * 60 * 1000;

/** uid → ms of the last pass. Ephemeral and best-effort, exactly as in `/presence`. */
const lastCheckByUid = new Map<string, number>();

/** Bounded so a long-lived instance cannot accumulate an entry per employee forever. */
const MAX_TRACKED_UIDS = 500;

export const POST = withAuth(async (request: NextRequest, token: DecodedIdToken) => {
  const uid = token.uid;
  const now = Date.now();

  const last = lastCheckByUid.get(uid);
  if (last !== undefined && now - last < MIN_CHECK_GAP_MS) {
    return NextResponse.json({ success: true, skipped: 'throttled' });
  }

  // The device's own zone is a fallback, not a peer: it is client input, so it
  // is only consulted when the platform header is absent (local dev, or a
  // self-hosted run). `isValidTimezone` is what keeps an arbitrary string off
  // the user record and out of the `Intl` calls downstream.
  const body = await request.json().catch(() => ({}));
  const deviceTimezone = (body as { deviceTimezone?: unknown })?.deviceTimezone;
  const detected =
    timezoneFromRequest(request) ??
    (isValidTimezone(deviceTimezone) ? deviceTimezone : null);

  if (!detected) {
    return NextResponse.json({ success: true, detected: null });
  }

  lastCheckByUid.set(uid, now);
  if (lastCheckByUid.size >= MAX_TRACKED_UIDS) lastCheckByUid.clear();

  const user = await getUserById(uid);
  if (!user) {
    // A valid token whose `users` doc is gone. Nothing to correct.
    return NextResponse.json({ success: false }, { status: 200 });
  }

  if (user.timezoneSource === 'manual') {
    return NextResponse.json({ success: true, skipped: 'manual' });
  }

  const offset = getOffsetForTimezone(detected);
  const zoneUnchanged = user.timezone === detected;
  // The stored offset still has to be refreshed twice a year even when the zone
  // itself has not moved — it is a rendered label ("UTC+02"), and DST makes it
  // wrong for half the year otherwise.
  const offsetUnchanged = user.timezoneOffset === offset;
  if (zoneUnchanged && offsetUnchanged) {
    return NextResponse.json({ success: true, detected, changed: false });
  }

  await adminDb.collection('users').doc(uid).update({
    timezone: detected,
    timezoneOffset: offset,
    timezoneSource: 'auto',
    timezoneDetectedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  // Rule 2: the user doc was written, so the 60s read cache must be dropped.
  invalidateUserCache(uid);

  return NextResponse.json({ success: true, detected, changed: true });
});
