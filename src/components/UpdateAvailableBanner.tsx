'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Download, Loader2, X } from 'lucide-react';
import { getAppInfo } from '@/lib/appVersion';
import { APP_UPDATE, getPlatformUpdate } from '@/lib/appUpdateConfig';
import { useTimeTrackingContext } from '@/contexts/TimeTrackingContext';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog';

/**
 * Electron-only update prompt. Two independent axes:
 *
 *  **Policy — what the user is told — comes only from `APP_UPDATE`.**
 *  `getPlatformUpdate(platform)` returns the entry for the running OS, or null
 *  ("no update targeted at you") in which case nothing renders. `compulsory`
 *  picks blocking dialog vs dismissible card. This is the *only* gate: on macOS
 *  a published GitHub release does not prompt anyone by itself.
 *
 *  **Delivery — what the button does — is feature-detected, not platform-based.**
 *  `updater.getPending` present (macOS v0.8.0+) → 'auto': downloads in-app with
 *  a progress bar, then clocks out, flushes and restarts into the new version.
 *  Absent (Windows, or any pre-0.8.0 build, which shipped no updater) →
 *  'manual': opens `APP_UPDATE.downloadUrl`. Feature-detecting is what keeps a
 *  legacy mac build on the manual path rather than stranding it with a button
 *  that can't work.
 *
 * **A work session is never interrupted.** The decision latches ONCE per app
 * start, after hydration settles, and returns early unless the user is clocked
 * OUT at that moment — a user mid-session at launch sees nothing at all until
 * their next launch, whether the update is compulsory or not. On the auto path
 * the download is re-gated on live clock state, since a slow start-up check can
 * resolve after the user has clocked in. Once an auto download starts we
 * escalate to the modal even for an optional update: the app is about to restart
 * itself, so the user must not be able to clock in and start working underneath
 * it.
 *
 * An Electron build too old to expose `app.getVersion()` can't be compared, so
 * it's forced (when its platform is targeted at all) — this bootstraps the fleet
 * onto a readable version, then self-resolves. Only renders inside Electron.
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

function formatMB(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

type Mode = 'none' | 'optional' | 'blocking';
/** How the "Download update" button behaves. */
type Delivery = 'auto' | 'manual';
/** Sub-state of the auto path. */
type Phase = 'prompt' | 'downloading' | 'installing' | 'error';

export default function UpdateAvailableBanner() {
  const { displayState, isHydrating } = useTimeTrackingContext();
  const [mode, setMode] = useState<Mode>('none');
  const [delivery, setDelivery] = useState<Delivery>('manual');
  const [current, setCurrent] = useState<string | null>(null);
  const [target, setTarget] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const decidedRef = useRef(false);

  const [phase, setPhase] = useState<Phase>('prompt');
  const [percent, setPercent] = useState(0);
  const [transferred, setTransferred] = useState(0);
  const [total, setTotal] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Live session state. The start-up check can resolve seconds late (slow
  // network); by then the user may have clocked in, and we must not interrupt.
  const displayStateRef = useRef(displayState);
  useEffect(() => { displayStateRef.current = displayState; }, [displayState]);

  // Decide ONCE, the first render after session state has settled (hydration
  // done) — this is the "at start-up" decision. Because it never re-runs after
  // latching, a later publish or clock-in can't retroactively interrupt.
  useEffect(() => {
    if (decidedRef.current || isHydrating) return;
    decidedRef.current = true;

    const api = typeof window !== 'undefined' ? window.electronAPI : undefined;
    if (!api?.isElectron) return; // web browser — never prompt

    // Mid-session at launch → leave them alone entirely. They are prompted at
    // their next start-up instead. Applies to compulsory updates too.
    if (displayState !== 'clocked-out') return;

    (async () => {
      const { appVersion, platform } = await getAppInfo();

      // The one gate: no config entry → this release isn't aimed at this OS.
      const cfg = getPlatformUpdate(platform);
      if (!cfg) return;

      // A build too old to report its version can't be compared — force it.
      // Self-resolving: once updated, getVersion exists and this never fires.
      if (appVersion && compareSemver(appVersion, cfg.latestVersion) >= 0) return; // up to date
      const compulsory = appVersion ? cfg.compulsory : true;
      setCurrent(appVersion);

      const updater = api.updater;
      if (updater?.getPending && updater.download) {
        // Auto path. Only offer it if the updater can actually see the release —
        // otherwise the button would do nothing, and a compulsory dialog would
        // trap the user with no way forward.
        const pending = await updater.getPending().catch(() => null);
        if (!pending) return;
        if (displayStateRef.current !== 'clocked-out') return; // clocked in since — never interrupt
        setTarget(pending.version ?? cfg.latestVersion);
        setDelivery('auto');
      } else {
        setTarget(cfg.latestVersion);
        setDelivery('manual');
      }
      setMode(compulsory ? 'blocking' : 'optional');
    })();
  }, [isHydrating, displayState]);

  // Download progress + failures. Auto path only.
  useEffect(() => {
    if (mode === 'none' || delivery !== 'auto') return;
    const updater = window.electronAPI?.updater;
    if (!updater) return;

    updater.onProgress(p => {
      setPercent(p.percent);
      setTransferred(p.transferred);
      setTotal(p.total);
    });
    updater.onStatus(s => {
      if (s.status !== 'error') return;
      setErrorMsg(s.message ?? null);
      setPhase('error');
    });
    // The shell asks the renderer to flush before it restarts;
    // TimeTrackingContext owns the clock-out + the ready-to-install ack. This is
    // only here to move the dialog into its final state.
    updater.onBeforeInstall(() => setPhase('installing'));

    // Deliberately no cleanup: `removeListeners()` is `removeAllListeners` on
    // shared channels, so it would also rip out TimeTrackingContext's
    // before-install flush handler. This effect latches once per app start and
    // the app is restarting anyway; re-registering the handlers is harmless
    // (they only call setState) whereas clobbering the flush loses time data.
  }, [mode, delivery]);

  const openDownload = () => {
    // target=_blank is intercepted by the shell's setWindowOpenHandler → opens
    // in the external browser.
    window.open(APP_UPDATE.downloadUrl, '_blank', 'noopener,noreferrer');
  };

  const startDownload = useCallback(() => {
    setErrorMsg(null);
    setPercent(0);
    setPhase('downloading');
    window.electronAPI?.updater?.download?.();
  }, []);

  if (mode === 'none') return null;

  const versionLine = current
    ? `You're on v${current}. v${target} is available.`
    : `A newer version (v${target}) is available.`;

  // An in-flight auto update takes over the screen even when optional: the app
  // is about to restart, so the user must not start working underneath it.
  const inProgress = delivery === 'auto' && phase !== 'prompt';

  if (mode === 'blocking' || inProgress) {
    const busy = phase === 'downloading' || phase === 'installing';
    const onAct = delivery === 'auto' ? startDownload : openDownload;
    return (
      <AlertDialog open>
        <AlertDialogContent onEscapeKeyDown={(e) => e.preventDefault()}>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {inProgress ? 'Updating Bluu Backend' : 'Update required'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {phase === 'installing'
                ? 'Finishing up and restarting Bluu Backend. This only takes a moment — please don’t quit the app.'
                : phase === 'downloading'
                  ? 'Downloading the update. Bluu Backend will restart automatically when it’s ready.'
                  : 'This update includes important security and app improvements. You must update to continue using Bluu Backend.'}
              {phase === 'prompt' && (
                <span className="mt-2 block text-xs">
                  {current ? `You're on v${current} — ` : 'Your app is out of date — '}
                  v{target} is required.
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>

          {phase === 'downloading' && (
            <div className="space-y-2">
              <Progress value={percent} />
              <p className="text-xs text-muted-foreground">
                {total > 0
                  ? `${formatMB(transferred)} of ${formatMB(total)} (${Math.round(percent)}%)`
                  : 'Starting download…'}
              </p>
            </div>
          )}

          {phase === 'error' && (
            <p className="text-xs text-destructive">
              The update couldn’t be downloaded{errorMsg ? `: ${errorMsg}` : '.'} Check your connection and try again.
            </p>
          )}

          <AlertDialogFooter>
            {/* An optional update that failed to download must not trap the user
                in a modal — let them carry on and retry at the next start-up. */}
            {mode === 'optional' && phase === 'error' && (
              <AlertDialogCancel onClick={() => { setPhase('prompt'); setDismissed(true); }}>
                Later
              </AlertDialogCancel>
            )}
            <AlertDialogAction disabled={busy} onClick={(e) => { e.preventDefault(); onAct(); }}>
              {busy
                ? <><Loader2 className="size-4 animate-spin" />{phase === 'installing' ? 'Restarting…' : 'Downloading…'}</>
                : <><Download className="size-4" />{phase === 'error' ? 'Try again' : 'Download update'}</>}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  }

  if (dismissed) return null;

  return (
    <Card className="fixed bottom-5 right-5 z-[9999] w-[22rem] max-w-[calc(100vw-2.5rem)] shadow-lg">
      <CardHeader>
        <CardTitle className="text-sm">Update available</CardTitle>
        <CardDescription>{versionLine}</CardDescription>
        <button
          onClick={() => setDismissed(true)}
          aria-label="Dismiss"
          className="absolute right-4 top-4 text-muted-foreground hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </CardHeader>
      <CardContent>
        <Button size="sm" onClick={delivery === 'auto' ? startDownload : openDownload}>
          <Download className="size-4" />
          Download update
        </Button>
      </CardContent>
    </Card>
  );
}
