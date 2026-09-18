/**
 * The announcements this caller should currently see.
 *
 * Exists for one reason: **cross-cutting rule 9c.** The Electron renderer never
 * reloads on its own, so a user who leaves the app running for a week is
 * executing whatever `ANNOUNCEMENTS` said the day they launched. Arming an
 * announcement has to reach them over the wire or it does not reach them at all.
 * Same job `/api/app-update` does for the update prompt.
 *
 * **The cohort match happens here, not on the client.** Doing it server-side
 * keeps the uid and group lists — which name colleagues — out of every
 * renderer's memory, and costs nothing: `getUserById` is cached for 60s, and the
 * card only fetches on mount and on a clock-out.
 *
 * Dismissals and `hideWhen` are applied here too, but the client re-checks
 * `hideWhen` live against its user snapshot: this response is a point-in-time
 * answer, and "the thing you were asked to do just happened" should retire the
 * card immediately rather than at the next fetch.
 *
 * **Cacheability (rule 9i): deliberately `no-store`, and it must stay that way.**
 * Two independent reasons, either one sufficient:
 *   1. **It cannot be shared-cached at all.** The body is the result of a cohort
 *      match plus this user's dismissals — per-user by construction. A CDN entry
 *      would show one employee an announcement aimed at another and leak the
 *      existence of a targeted rollout (rule 10). `private` would stop that, but
 *      `private` is also what makes `s-maxage` inert, so there is no CDN win here
 *      to trade the risk against.
 *   2. **Serving it stale defeats the route.** It exists only because of rule 9c
 *      — a renderer that has been open for a week must learn that an announcement
 *      was armed. A cached "nothing is armed" is precisely the failure this
 *      endpoint was built to remove. `fetchAnnouncements` sends `cache: 'no-store'`
 *      for the same reason; this header is the server half of that contract, so a
 *      proxy cannot reintroduce staleness the client took care to avoid.
 *
 * The volume this would have saved is gone anyway: `AnnouncementCard` latches its
 * load per uid, so this is a handful of calls per user per session, not a poll.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { getUserById } from '@/lib/services/userService';
import { ANNOUNCEMENTS, selectAnnouncements } from '@/lib/announcementConfig';
import type { DecodedIdToken } from 'firebase-admin/auth';

/** See the cacheability note above — this is never cacheable, on any hop. */
const NO_STORE = { 'Cache-Control': 'no-store' } as const;

export const GET = withAuth(async (_request: NextRequest, token: DecodedIdToken) => {
  try {
    const user = await getUserById(token.uid);

    const announcements = selectAnnouncements(ANNOUNCEMENTS, {
      uid: token.uid,
      groups: user?.groups ?? [],
      dismissedAnnouncements: user?.dismissedAnnouncements ?? [],
      telegram: user?.telegram ?? null,
      telegramPromptedAtOnboarding: user?.telegramPromptedAtOnboarding ?? false,
    }).map((a) => ({
      // Cohort fields are the server's business and name other people — the
      // client needs only what it renders and what it acts on.
      id: a.id,
      title: a.title,
      body: a.body,
      primaryLabel: a.primaryLabel,
      action: a.action,
      secondaryLabel: a.secondaryLabel,
      dismissible: a.dismissible,
      hideWhen: a.hideWhen ?? null,
    }));

    return NextResponse.json({ announcements }, { headers: NO_STORE });
  } catch (error: unknown) {
    console.error('[GET /api/announcements]', error);
    // An empty list, not a 500: a failure here must never block the app shell,
    // and showing nothing is the safe default for an interruption.
    return NextResponse.json({ announcements: [] }, { headers: NO_STORE });
  }
});
