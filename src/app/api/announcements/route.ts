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
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { getUserById } from '@/lib/services/userService';
import { ANNOUNCEMENTS, selectAnnouncements } from '@/lib/announcementConfig';
import type { DecodedIdToken } from 'firebase-admin/auth';

export const GET = withAuth(async (_request: NextRequest, token: DecodedIdToken) => {
  try {
    const user = await getUserById(token.uid);

    const announcements = selectAnnouncements(ANNOUNCEMENTS, {
      uid: token.uid,
      groups: user?.groups ?? [],
      dismissedAnnouncements: user?.dismissedAnnouncements ?? [],
      telegram: user?.telegram ?? null,
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

    return NextResponse.json({ announcements });
  } catch (error: unknown) {
    console.error('[GET /api/announcements]', error);
    // An empty list, not a 500: a failure here must never block the app shell,
    // and showing nothing is the safe default for an interruption.
    return NextResponse.json({ announcements: [] });
  }
});
