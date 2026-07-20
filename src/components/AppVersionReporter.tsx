'use client';

import { useEffect, useRef } from 'react';
import { getAppInfo } from '@/lib/appVersion';
import { useAuth } from '@/components/AuthProvider';
import { useUserData } from '@/hooks/useUserData';

/**
 * Reports the installed Electron build onto the user's own doc so admins can
 * see each employee's app version (User Management → user detail).
 *
 * Cheap by construction: the current stored value comes free off the existing
 * `users/{uid}` snapshot, so this posts **only** when the running build differs
 * from what is already stored — i.e. once after an update, never on a normal
 * start-up. No-ops outside Electron and on builds too old to report a version.
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
      if (appVersion === userData.appVersion && (platform ?? null) === (userData.appPlatform ?? null)) return;
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
