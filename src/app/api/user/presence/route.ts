import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { adminDb } from '@/lib/firebase-admin';
import { invalidateUserCache } from '@/lib/services/userService';
import { FieldValue } from 'firebase-admin/firestore';
import type { DecodedIdToken } from 'firebase-admin/auth';

/**
 * POST /api/user/presence
 *
 * Stamps `users/{uid}.lastActiveAt` — the real "last seen".
 *
 * ## Why this exists
 *
 * The Employee Registry used to show `lastLoginAt` as "seen …", which is only
 * written at sign-in. The Electron shell never reloads and users never quit it
 * (rule 9c), so that value is months old for most of the fleet and says nothing
 * about whether anyone has opened the app since. This route is the presence
 * half: every authenticated window mounts `PresenceReporter`, which posts here
 * on a slow interval for as long as the app is open in any capacity.
 *
 * ## Cost (rule 9)
 *
 * Deliberately a **write-only, read-free** route:
 *
 *  • **No reads.** It never fetches the doc to compare — the granularity of a
 *    "last seen" does not justify a read per ping. `update()` on one field is
 *    the entire Firestore interaction.
 *  • **The client is the primary throttle** (one ping per `PRESENCE_INTERVAL_MS`
 *    per window), and {@link lastWriteByUid} is the backstop that collapses the
 *    duplicate pings from a user running the main window alongside the OF
 *    Manager / GoLogin satellites. Worst case on a cold lambda is one write per
 *    open window; steady state is one write per user per ~10 minutes.
 *  • `lastActiveAt` is **exempt from single-field indexing** in
 *    `firestore.indexes.json` — nothing queries it (the registry reads whole
 *    docs and sorts client-side), and it is the highest-frequency write on the
 *    user doc. If a "who is online right now" query is ever wanted, the
 *    exemption must be removed and the index rebuilt first.
 *  • The admin-users list cache is deliberately **not** invalidated. Its TTL is
 *    30s and this field's resolution is ~10 minutes, so invalidating would
 *    force a full `users` collection re-read several times a minute to refresh
 *    a value that had not meaningfully changed.
 *
 * Machine-reported, so — like `/api/user/app-version` — it is deliberately not
 * part of the `/api/user/update` whitelist. The body is ignored entirely: the
 * only thing this route records is "the caller's app was open just now", and
 * the bearer token is the whole of that claim.
 */

/** One persisted write per user per this window, per server instance. */
const MIN_WRITE_GAP_MS = 5 * 60 * 1000;

/**
 * uid → ms of the last persisted stamp, per lambda instance. Ephemeral and
 * best-effort on purpose: losing it on a cold start costs at most one extra
 * write, so it never needs to be durable.
 */
const lastWriteByUid = new Map<string, number>();

/** Bounded so a long-lived instance cannot accumulate an entry per employee forever. */
const MAX_TRACKED_UIDS = 500;

export const POST = withAuth(async (_request: NextRequest, token: DecodedIdToken) => {
  const uid = token.uid;
  const now = Date.now();

  const last = lastWriteByUid.get(uid);
  if (last !== undefined && now - last < MIN_WRITE_GAP_MS) {
    return NextResponse.json({ success: true, skipped: true });
  }

  try {
    await adminDb
      .collection('users')
      .doc(uid)
      .update({ lastActiveAt: FieldValue.serverTimestamp() });
  } catch {
    // A valid token whose `users` doc is gone (deleted mid-session) lands here.
    // Presence is not worth surfacing an error for — the client's next ping
    // will fail the same way and the session is about to be torn down anyway.
    return NextResponse.json({ success: false }, { status: 200 });
  }

  if (lastWriteByUid.size >= MAX_TRACKED_UIDS) lastWriteByUid.clear();
  lastWriteByUid.set(uid, now);

  // Rule 2: the user doc was written, so the 60s read cache must be dropped.
  invalidateUserCache(uid);

  return NextResponse.json({ success: true });
});
