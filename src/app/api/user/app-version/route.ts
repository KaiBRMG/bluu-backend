import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/middleware/withAuth';
import { adminDb } from '@/lib/firebase-admin';
import { invalidateUserCache } from '@/lib/services/userService';
import { invalidateAdminUsersCache } from '@/app/api/admin/users/route';
import { FieldValue } from 'firebase-admin/firestore';
import { addNotificationToBatch } from '@/lib/middleware/apiHelpers';
import { notifications } from '@/lib/notificationContent';
import {
  APP_UPDATE,
  matchesUpdateCohort,
  releaseNoteVersionQualifies,
} from '@/lib/appUpdateConfig';
import type { DecodedIdToken } from 'firebase-admin/auth';

/**
 * POST /api/user/app-version
 * Records the caller's installed desktop build on their own user doc so admins
 * can see which version each employee is running (User Management → detail).
 *
 * Machine-reported, so it is deliberately NOT part of the /api/user/update
 * whitelist. The client (AppVersionReporter) calls this only when it has
 * something to say — the running build differs from the stored one, or a release
 * note is owed — so this is not on the normal app-start path.
 *
 * It is also where the **release note** is sent: the version a user is running
 * is exactly what decides whether they should hear about a release, and this is
 * the one authenticated place that learns it. The client's opinion is never
 * trusted — the gate is re-evaluated here against the version it just reported.
 */
export const POST = withAuth(async (request: NextRequest, token: DecodedIdToken) => {
  try {
    const body = await request.json().catch(() => null);
    const rawVersion = body?.appVersion;
    const rawPlatform = body?.platform;

    if (typeof rawVersion !== 'string' || !rawVersion.trim()) {
      return NextResponse.json({ error: 'appVersion is required' }, { status: 400 });
    }
    // Semver-ish only — this string is rendered in the admin UI.
    if (!/^[0-9A-Za-z.\-+]{1,32}$/.test(rawVersion)) {
      return NextResponse.json({ error: 'Invalid appVersion' }, { status: 400 });
    }

    const platform =
      typeof rawPlatform === 'string' && /^[a-z0-9]{1,16}$/.test(rawPlatform) ? rawPlatform : null;

    const userRef = adminDb.collection('users').doc(token.uid);
    const update: Record<string, unknown> = {
      appVersion: rawVersion,
      appPlatform: platform,
      appVersionUpdatedAt: FieldValue.serverTimestamp(),
    };

    // ─── Release note ────────────────────────────────────────────────────────
    // Only for a build that actually qualifies, and only once per user per
    // release. The read is one doc on a route that fires at most a couple of
    // times per user per release, and it is skipped entirely between releases
    // (releaseNote: null) — so this adds no I/O to the steady state (rule 9).
    const note = APP_UPDATE.releaseNote;
    const batch = adminDb.batch();
    let sendingNote = false;

    if (note && releaseNoteVersionQualifies(rawVersion)) {
      const snap = await userRef.get();
      const data = snap.data();
      // The cohort half of the gate, checked against the SERVER's copy of the
      // user's groups — the client never gets a say in which release note it is
      // eligible for. Read off the snapshot this branch already fetched, so
      // staging a note costs no extra I/O (rule 9).
      //
      // A user outside the cohort is deliberately left unmarked rather than
      // marked-and-skipped: widening the cohort later must still reach them.
      // (Contrast the onboarding case below, where marking IS the intent.)
      const inCohort = matchesUpdateCohort(note, {
        uid: token.uid,
        groups: Array.isArray(data?.groups) ? data.groups : [],
      });
      if (snap.exists && inCohort && data?.releaseNoteNotifiedVersion !== note.version) {
        // A user still in first-run onboarding has no "before" to compare the
        // release against — every feature in it is new to them — so a "what's
        // new" note is noise, and it would land in the tray before they have
        // even finished setting the app up. They are marked as notified rather
        // than skipped, so the note never arrives late once they finish. This
        // suppresses only the note armed right now; the next release reaches
        // them normally. `hasCompletedOnboarding` is read off the snapshot this
        // branch already fetched, so the check is free (rule 9).
        const stillOnboarding = data?.hasCompletedOnboarding !== true;
        update.releaseNoteNotifiedVersion = note.version;
        if (!stillOnboarding) {
          sendingNote = true;
          // Deterministic id: two app starts racing each other can only produce
          // this one document, never a duplicate "what's new" in the tray.
          addNotificationToBatch(batch, token.uid, notifications.releaseNote(note.version), {
            docId: `${token.uid}__release-${note.version}`,
          });
        }
      }
    }

    batch.update(userRef, update);
    await batch.commit();

    invalidateUserCache(token.uid);
    invalidateAdminUsersCache();

    return NextResponse.json({ success: true, releaseNoteSent: sendingNote });
  } catch (error: unknown) {
    console.error('[user/app-version] error:', error);
    return NextResponse.json({ error: 'Failed to record app version' }, { status: 500 });
  }
});
