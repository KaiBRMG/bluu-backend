'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Download, Loader2, RefreshCw, X } from 'lucide-react';
import { getAppInfo } from '@/lib/appVersion';
import { compareSemver } from '@/lib/semver';
import { APP_UPDATE, fetchAppUpdateConfig, resolvePlatformUpdate } from '@/lib/appUpdateConfig';
import { setUpdateInFlight } from '@/lib/updateInFlight';
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
 *  **Delivery — what the button does — is feature-detected, with one hard
 *  platform rule: macOS is NEVER given the download link.** `electron-updater`
 *  is the only sanctioned way a Mac updates. A hand reinstall over a running
 *  signed app is how users end up on the wrong architecture (the x64 `.dmg`
 *  carries no arch suffix, so Apple Silicon users land on Rosetta and then take
 *  x64 updates forever) or on a build that quietly stops auto-updating.
 *
 *  - `updater.getPending` present **and** an update pending → **'auto'**:
 *    downloads in-app with a progress bar, then clocks out, flushes and restarts
 *    into the new version.
 *  - macOS with nothing pending → **'restart'**: the shell checks GitHub once at
 *    start-up, so a long-running app hasn't looked since the release shipped.
 *    The dialog says to quit and reopen; there is no button, because no in-app
 *    action helps and a link is not on offer here.
 *  - Windows → **'manual'**: opens the config's `downloadUrl`, which is how that
 *    platform has always updated (no valid signing cert → no auto-update).
 *
 * **A work session is never interrupted — but the prompt is no longer a
 * once-per-launch lottery.** The single trigger condition is
 * `displayState === 'clocked-out'`, and it is re-checked for the **whole app
 * session** rather than latched at boot (same pattern as
 * `EmailMigrationDialog`). A user who is mid-shift when the app starts sees
 * nothing, and then gets prompted the moment they clock out — instead of being
 * stranded until a relaunch that, for anyone who leaves the app running across
 * shifts, may never come. Once an auto download starts we escalate to the modal
 * even for an optional update: the app is about to restart itself, so the user
 * must not be able to clock in and start working underneath it.
 *
 * Three ways a user used to escape the prompt entirely, all closed here:
 *
 *  1. **Clocked in during the check.** The decision ran a couple of `await`s
 *     (version IPC, updater IPC) after hydration settled, and the auto path
 *     bailed if the user clocked in meanwhile. Because the decision also
 *     latched, bailing meant *never* prompted this launch. The window is small
 *     — Clock In is disabled while `isHydrating` — but it exists, and it is now
 *     harmless: bailing just leaves the banner undecided, and clocking out
 *     re-runs it. Both delivery paths re-check, not only the auto one.
 *  2. **Never quitting the app.** Two separate staleness problems, both fixed:
 *     the decision itself is re-evaluated (above), and the policy is read from
 *     `/api/app-update` rather than the bundled constant, because a renderer
 *     that never fully reloads is running whatever `APP_UPDATE` said the day it
 *     launched. See `fetchAppUpdateConfig`.
 *  3. **The updater hadn't answered yet (macOS).** `updater.getPending()`
 *     returns the result of a start-up check against GitHub; if that check has
 *     not resolved — or the release was published after this app launched —
 *     it is null, and the banner used to render nothing at all. We now (a)
 *     listen for `updater:available` and re-evaluate when the late answer
 *     arrives, and (b) show the **'restart'** prompt instead of silence: the
 *     config has already established this user is behind, and reopening the app
 *     is what makes the shell check again.
 *
 * An Electron build too old to expose `app.getVersion()` can't be compared, so
 * it's forced (when its platform is targeted at all) — this bootstraps the fleet
 * onto a readable version, then self-resolves. Only renders inside Electron.
 */

function formatMB(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

type Mode = 'none' | 'optional' | 'blocking';
/**
 * How the update is delivered.
 *
 * - `auto`    — in-app download + restart (`electron-updater`). **The only path
 *               macOS is ever offered.**
 * - `manual`  — opens `downloadUrl` for a hand reinstall. **Windows only.**
 * - `restart` — macOS, update targeted but the shell has nothing pending: the
 *               updater checks GitHub once at start-up, so a long-running app
 *               simply hasn't looked since the release went out. Quitting and
 *               reopening makes it check again. No button, because there is no
 *               in-app action that helps — and no link, per the rule above.
 */
type Delivery = 'auto' | 'manual' | 'restart';
/** Sub-state of the auto path. */
type Phase = 'prompt' | 'downloading' | 'installing' | 'error';

export default function UpdateAvailableBanner() {
  const { displayState, isHydrating } = useTimeTrackingContext();
  const [mode, setMode] = useState<Mode>('none');
  const [delivery, setDelivery] = useState<Delivery>('manual');
  const [current, setCurrent] = useState<string | null>(null);
  const [target, setTarget] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  // Manual-install landing page, taken from the live config (see below) so a
  // long-running renderer can't send the user to a stale URL.
  const [downloadUrl, setDownloadUrl] = useState(APP_UPDATE.downloadUrl);
  // Guards the async decision against overlapping runs, now that it can be
  // re-entered on any clock-out. Not a "decided" latch — `mode` is that.
  const evaluatingRef = useRef(false);
  // Bumped when the shell reports an update *after* we already looked.
  const [availableTick, setAvailableTick] = useState(0);

  const [phase, setPhase] = useState<Phase>('prompt');
  const [percent, setPercent] = useState(0);
  const [transferred, setTransferred] = useState(0);
  const [total, setTotal] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Live session state. The start-up check can resolve seconds late (slow
  // network); by then the user may have clocked in, and we must not interrupt.
  const displayStateRef = useRef(displayState);
  useEffect(() => { displayStateRef.current = displayState; }, [displayState]);

  // A late `update-available` from the shell's start-up check. The renderer
  // usually mounts after that check resolves and reads the result from
  // `getPending()`, but not always — a slow GitHub round-trip lands after we
  // have already looked and found nothing. Previously that event was emitted
  // into a component that never listened for it, and the prompt was simply lost
  // for the launch. Registered once; no cleanup, for the same reason the
  // progress effect below has none (`removeListeners` is `removeAllListeners`
  // on channels TimeTrackingContext also uses).
  useEffect(() => {
    window.electronAPI?.updater?.onAvailable?.(() => setAvailableTick(t => t + 1));
  }, []);

  // Decide whenever the user is clocked OUT and we have not already decided.
  // This is re-checked for the whole app session rather than latched at boot:
  // "don't interrupt a shift" is enforced by the clocked-out condition itself,
  // so latching bought nothing and cost every user who was mid-shift at launch,
  // or who never quits the app, their prompt entirely.
  useEffect(() => {
    if (mode !== 'none') return;          // already decided — `mode` is the latch
    if (isHydrating) return;              // clock state not settled yet
    if (displayState !== 'clocked-out') return; // never interrupt a shift
    if (evaluatingRef.current) return;    // a decision is already in flight
    evaluatingRef.current = true;

    (async () => {
      try {
        const api = typeof window !== 'undefined' ? window.electronAPI : undefined;
        if (!api?.isElectron) return; // web browser — never prompt

        const { appVersion, platform } = await getAppInfo();

        // The live policy, not the copy compiled into this bundle — a renderer
        // that has been up for a week has never seen the config we armed since.
        const config = await fetchAppUpdateConfig();

        // The one gate: no config entry → this release isn't aimed at this OS.
        const cfg = resolvePlatformUpdate(config, platform);
        if (!cfg) return;

        // A build too old to report its version can't be compared — force it.
        // Self-resolving: once updated, getVersion exists and this never fires.
        if (appVersion && compareSemver(appVersion, cfg.latestVersion) >= 0) return; // up to date
        const compulsory = appVersion ? cfg.compulsory : true;

        const updater = api.updater;
        const pending = updater?.getPending && updater.download
          ? await updater.getPending().catch(() => null)
          : null;

        // Re-check live clock state after every await, on EVERY delivery path:
        // the user may have clocked in while we were resolving. Bailing here is
        // now cheap — this effect re-runs the next time they clock out.
        if (displayStateRef.current !== 'clocked-out') return;

        setDownloadUrl(config.downloadUrl);
        setCurrent(appVersion);
        if (pending) {
          setTarget(pending.version ?? cfg.latestVersion);
          setDelivery('auto');
        } else {
          // No pending update. This is NOT "up to date" — the version
          // comparison above already ruled that out — it means the shell's
          // start-up check hasn't answered, or the release was published after
          // this app launched.
          //
          // macOS never gets the download link. Auto-update is the only
          // sanctioned path there: a hand reinstall over a running signed app
          // is exactly how users end up on the wrong arch (the x64 .dmg has no
          // suffix) or on a stale build that quietly stops receiving updates.
          // The honest instruction is "quit and reopen" — that is what makes
          // the shell check GitHub again, and the update then installs itself.
          setTarget(cfg.latestVersion);
          setDelivery(platform === 'darwin' ? 'restart' : 'manual');
        }
        setMode(compulsory ? 'blocking' : 'optional');
      } finally {
        evaluatingRef.current = false;
      }
    })();
  }, [mode, isHydrating, displayState, availableTick]);

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
      setUpdateInFlight(false); // nothing is running — a reload is safe again
    });
    // The shell asks the renderer to flush before it restarts;
    // TimeTrackingContext owns the clock-out + the ready-to-install ack. This is
    // only here to move the dialog into its final state.
    updater.onBeforeInstall(() => {
      setPhase('installing');
      setUpdateInFlight(true);
    });

    // Deliberately no cleanup: `removeListeners()` is `removeAllListeners` on
    // shared channels, so it would also rip out TimeTrackingContext's
    // before-install flush handler. This effect latches once per app start and
    // the app is restarting anyway; re-registering the handlers is harmless
    // (they only call setState) whereas clobbering the flush loses time data.
  }, [mode, delivery]);

  const openDownload = () => {
    // target=_blank is intercepted by the shell's setWindowOpenHandler → opens
    // in the external browser.
    window.open(downloadUrl, '_blank', 'noopener,noreferrer');
  };

  const startDownload = useCallback(() => {
    setErrorMsg(null);
    setPercent(0);
    setPhase('downloading');
    // Hold off `DeploymentRefresher`: a reload now would drop this dialog while
    // the main process kept downloading. Cleared again if the download errors.
    setUpdateInFlight(true);
    window.electronAPI?.updater?.download?.();
  }, []);

  if (mode === 'none') return null;

  const versionLine = current
    ? `You're on v${current}. v${target} is available.`
    : `A newer version (v${target}) is available.`;

  // An in-flight auto update takes over the screen even when optional: the app
  // is about to restart, so the user must not start working underneath it.
  const inProgress = delivery === 'auto' && phase !== 'prompt';

  // macOS with nothing pending: there is no in-app action, and no download link
  // is offered on that platform. Quitting and reopening is the whole remedy.
  const needsRestart = delivery === 'restart';
  const restartLine = `Quit Bluu Backend and open it again — v${target} installs itself on the next start-up.`;

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
                  : needsRestart
                    ? `This update includes important security and app improvements. ${restartLine}`
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

          {/* No footer on the restart path: every action lives outside the app
              (Cmd-Q, then reopen), and a button that can't do the thing it
              names is worse than none. */}
          {!needsRestart && (
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
          )}
        </AlertDialogContent>
      </AlertDialog>
    );
  }

  if (dismissed) return null;

  return (
    <Card className="fixed bottom-5 right-5 z-[var(--z-banner)] w-[22rem] max-w-[calc(100vw-2.5rem)]">
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
        {needsRestart ? (
          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <RefreshCw className="mt-0.5 size-4 shrink-0" />
            {restartLine}
          </p>
        ) : (
          <Button size="sm" onClick={delivery === 'auto' ? startDownload : openDownload}>
            <Download className="size-4" />
            Download update
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
