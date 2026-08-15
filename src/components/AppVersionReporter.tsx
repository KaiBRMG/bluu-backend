'use client';

import { useEffect, useRef } from 'react';
import { getAppInfo } from '@/lib/appVersion';
import { useAuth } from '@/components/AuthProvider';
import { useUserData } from '@/hooks/useUserData';
import { APP_UPDATE, releaseNoteAppliesTo } from '@/lib/appUpdateConfig';

/**
 * Reports the installed Electron build onto the user's own doc so admins can
 * see each employee's app version (User Management → user detail), and is the
 * trigger for the release-note notification.
 *
 * Cheap by construction: everything it compares against comes free off the
 * existing `users/{uid}` snapshot, so it posts only when it has something to
 * say. No-ops outside Electron and on builds too old to report a version.
 *
 * **Two reasons to post, not one.** Reporting a changed version is the obvious
 * trigger, but a release note cannot rely on it: a user who updates *before* the
 * note is armed in `appUpdateConfig` has already reported that version, so a
 * change-only trigger would never fire again and they would simply never be told.
 * Hence the second condition — a note is owed for the build they are on. It is a
 * pure snapshot comparison, so it costs nothing to evaluate every start, and it
 * stops being true the moment the server records the send.
 */
export default function AppVersionReporter() {
  const { user } = useAuth();
  const { userData } = useUserData();
  const sentRef = useRef(false);

  useEffect(() => {
    if (sentRef.current || !user || !userData) return;
    if (typeof window === 'undefined' || !window.electronAPI?.isElectron) return;

    (async () => {
      const { appVersion, platform } = await getAppInfo();
      if (!appVersion) return; // pre-0.8.0 build — can't report

      const versionChanged =
        appVersion !== userData.appVersion || (platform ?? null) !== (userData.appPlatform ?? null);
      const releaseNoteOwed =
        releaseNoteAppliesTo(appVersion) &&
        userData.releaseNoteNotifiedVersion !== APP_UPDATE.releaseNote?.version;

      if (!versionChanged && !releaseNoteOwed) return;
      if (sentRef.current) return;
      sentRef.current = true;

      try {
        const idToken = await user.getIdToken();
        await fetch('/api/user/app-version', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
          body: JSON.stringify({ appVersion, platform }),
        });
      } catch {
        // Non-critical — retried on the next app start.
        sentRef.current = false;
      }
    })();
  }, [user, userData]);

  return null;
}
