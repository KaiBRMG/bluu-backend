'use client';

import { useEffect, useState } from 'react';
import { getAppInfo, getCachedAppInfo } from '@/lib/appVersion';

/**
 * The installed Electron shell's version, for a component that has to *render*
 * differently because of it (a version-gated page).
 *
 * **It is a thin wrapper over `getAppInfo`, not a second cache.** That module
 * already memoises the IPC round trip and de-duplicates concurrent callers; this
 * adds the one thing a renderer needs on top and that a promise cannot express —
 * the distinction between "still asking" and "asked, and the answer is unknown".
 *
 * That distinction is the whole reason this exists. `meetsMinVersion` treats an
 * unknown version as failing the floor, which is the correct default for a
 * *decision* and the wrong thing to paint: a gated page would flash "update
 * required" for every user during the tick before the answer lands. Gate on
 * `status === 'resolved'` before rendering a refusal.
 *
 * `AppLayout` is mounted per-page and remounts on every navigation (see the
 * app-shell note in CLAUDE.md), which is why the memoisation matters: without
 * it this would be an IPC call per click for a value that cannot change without
 * the app restarting.
 */
export type AppVersionStatus = 'checking' | 'resolved';

/** The imperative form, for a click handler that should not re-render to ask. */
export function readAppVersion(): Promise<string | null> {
  return getAppInfo().then(info => info.appVersion);
}

export function useAppVersion(): { version: string | null; status: AppVersionStatus } {
  // Seeded from the shared cache so a remount after the first resolve renders
  // the right thing on its first pass, with no `checking` flicker.
  const [version, setVersion] = useState<string | null>(() => getCachedAppInfo().appVersion);
  const [status, setStatus] = useState<AppVersionStatus>(() =>
    getCachedAppInfo().appVersion !== null ? 'resolved' : 'checking',
  );

  useEffect(() => {
    let cancelled = false;
    getAppInfo()
      .then(info => {
        if (cancelled) return;
        setVersion(info.appVersion);
        setStatus('resolved');
      })
      .catch(() => {
        // `getAppInfo` swallows its own errors and resolves to nulls, so this is
        // belt-and-braces — but a rejected promise here would strand a gated
        // page on `checking` forever, which is the one outcome worth ruling out.
        if (!cancelled) setStatus('resolved');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { version, status };
}
