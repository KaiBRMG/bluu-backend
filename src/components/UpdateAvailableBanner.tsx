'use client';

import { useEffect, useRef, useState } from 'react';
import { Download, X } from 'lucide-react';
import { getAppInfo } from '@/lib/appVersion';
import { APP_UPDATE } from '@/lib/appUpdateConfig';
import { useTimeTrackingContext } from '@/contexts/TimeTrackingContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
} from '@/components/ui/alert-dialog';

/**
 * Electron-only manual-update prompt. Unsigned builds can't auto-install, so we
 * compare the running version (native `app.getVersion()`) against `APP_UPDATE`
 * (a code constant, deployed instantly via Vercel).
 *
 * Two modes, decided ONCE per app start-up (the constant is baked into the
 * bundle the window loaded at launch, so a mid-session publish never reaches a
 * running window until it restarts — a session is never interrupted):
 *  - **compulsory** → a blocking dialog the user cannot dismiss or click past;
 *    they must update to use the app. Only engages when NOT mid-session
 *    (clocked-out) at start-up, so active work is never interrupted.
 *  - **optional** → a dismissible card. Re-appears on next start-up, or when the
 *    user clocks out (the `bluu:clocked-out` event from TimeTrackingContext).
 *
 * An Electron build too old to expose `app.getVersion()` is treated as a
 * compulsory update regardless of `APP_UPDATE.compulsory` — this bootstraps the
 * whole fleet onto a readable version, then self-resolves (once everyone exposes
 * getVersion, the branch never fires again). Only renders inside Electron.
 */

/** Returns >0 if a>b, <0 if a<b, 0 if equal. Tolerant of non-numeric/partial versions. */
function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map(n => parseInt(n, 10) || 0);
  const pb = b.split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

type Mode = 'none' | 'optional' | 'blocking';

export default function UpdateAvailableBanner() {
  const { displayState, isHydrating } = useTimeTrackingContext();
  const [current, setCurrent] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('none');
  const [dismissed, setDismissed] = useState(false);
  const decidedRef = useRef(false);

  // Decide ONCE, the first render after session state has settled (hydration
  // done) — this is the "at start-up" decision. The running version resolves
  // asynchronously; the state update lands in the promise callback (not
  // synchronously in the effect body). Because it never re-runs after latching,
  // a later version publish or clock-in can't retroactively interrupt a session.
  useEffect(() => {
    if (decidedRef.current || isHydrating) return;
    decidedRef.current = true;

    const api = typeof window !== 'undefined' ? window.electronAPI : undefined;
    if (!api?.isElectron) return; // web browser — never prompt

    const startupState = displayState; // snapshot at start-up
    // Compulsory blocks, but only when NOT mid-session at start-up (never
    // interrupt active work; they'll be blocked at the next start-up instead).
    const decide = (compulsory: boolean): Mode =>
      compulsory && startupState === 'clocked-out' ? 'blocking' : 'optional';

    getAppInfo().then(({ appVersion }) => {
      if (!appVersion) {
        // Electron build too old to expose app.getVersion — force an update so
        // every client moves onto a readable version. Self-resolving: once
        // updated, getVersion exists and this branch never fires again.
        setMode(decide(true));
        return;
      }
      setCurrent(appVersion);
      if (compareSemver(appVersion, APP_UPDATE.latestVersion) >= 0) return; // up to date
      setMode(decide(APP_UPDATE.compulsory));
    });
  }, [isHydrating, displayState]);

  // Optional prompt re-appears when the user clocks out.
  useEffect(() => {
    const onClockOut = () => { if (mode === 'optional') setDismissed(false); };
    window.addEventListener('bluu:clocked-out', onClockOut);
    return () => window.removeEventListener('bluu:clocked-out', onClockOut);
  }, [mode]);

  const openDownload = () => {
    // target=_blank is intercepted by the shell's setWindowOpenHandler → opens
    // in the external browser.
    window.open(APP_UPDATE.downloadUrl, '_blank', 'noopener,noreferrer');
  };

  if (mode === 'blocking') {
    return (
      <AlertDialog open>
        <AlertDialogContent onEscapeKeyDown={(e) => e.preventDefault()}>
          <AlertDialogHeader>
            <AlertDialogTitle>Update required</AlertDialogTitle>
            <AlertDialogDescription>
              This update includes important security and app improvements. You must
              update to continue using Bluu Backend.
              <br />
              <span className="mt-2 block text-xs">
                {current ? `You're on v${current} — ` : 'Your app is out of date — '}
                v{APP_UPDATE.latestVersion} is required.
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            {/* No cancel — the user cannot proceed without updating. */}
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); openDownload(); }}
            >
              <Download className="size-4" />
              Download update
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  }

  if (mode !== 'optional' || dismissed) return null;

  return (
    <Card className="fixed bottom-5 right-5 z-[9999] w-[22rem] max-w-[calc(100vw-2.5rem)] shadow-lg">
      <CardHeader>
        <CardTitle className="text-sm">Update available</CardTitle>
        <CardDescription>
          {current
            ? `You're on v${current}. v${APP_UPDATE.latestVersion} is available.`
            : `A newer version (v${APP_UPDATE.latestVersion}) is available.`}
        </CardDescription>
        <button
          onClick={() => setDismissed(true)}
          aria-label="Dismiss"
          className="absolute right-4 top-4 text-muted-foreground hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </CardHeader>
      <CardContent>
        <Button size="sm" onClick={openDownload}>
          <Download className="size-4" />
          Download update
        </Button>
      </CardContent>
    </Card>
  );
}
