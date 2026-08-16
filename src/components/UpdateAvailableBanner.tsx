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
 * **`pending === null` is a "not yet", never a verdict — and the 'restart'
 * prompt is provisional.** This is the failure that stranded the fleet on
 * v0.10.0: `mode` is the latch, so the moment the restart prompt was shown the
 * decision was closed, and the `updater:available` listener above — added for
 * exactly this case — was discarded by the `mode !== 'none'` guard it ran into.
 * Meanwhile a null read is the *expected* one on a slow link: the shell's check
 * is two GitHub round trips (releases feed, then `latest-mac.yml` behind a
 * redirect) racing a renderer that needs one warm Vercel call to hydrate. Every
 * relaunch re-ran the same race at the same odds, which is why quitting and
 * reopening — the one thing the dialog told users to do — never helped.
 *
 * So the restart path now (a) does not close the decision: it re-evaluates on a
 * late `updater:available`, (b) polls `getPending()` for a bounded window and
 * upgrades itself to 'auto' in place, and (c) carries a **Check again** button.
 * The old copy ("v0.x installs itself on the next start-up") was also simply
 * untrue — `autoDownload` and `autoInstallOnAppQuit` are both false in
 * `main.js`, so a relaunch only re-runs the check; nothing installs until the
 * user presses Download. A compulsory update on this path therefore had no
 * reachable action anywhere in the app.
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
 * - `restart` — macOS, update targeted but the shell has nothing pending yet.
 *               **Provisional**: it is polled out of, and upgrades itself to
 *               `auto` the moment the check answers. Still no download link
 *               (per the rule above) — the only actions offered are Check again
 *               and, as a last resort, quitting.
 */
type Delivery = 'auto' | 'manual' | 'restart';
/** Sub-state of the auto path. */
type Phase = 'prompt' | 'downloading' | 'installing' | 'error';

/** How often the restart path re-reads the shell's check, and for how long. */
const RESTART_POLL_INTERVAL_MS = 2000;
const RESTART_POLL_WINDOW_MS = 60_000;

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

  // Restart path only. `checkError` is the shell's own check failure (the main
  // process merely console.errors it, so this is the only place it surfaces);
  // `pollExhausted` means we waited out the window and the check still has not
  // answered — the point at which quitting really is the remaining option.
  const [checkError, setCheckError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [pollExhausted, setPollExhausted] = useState(false);
  const [pollNonce, setPollNonce] = useState(0);

  const [phase, setPhase] = useState<Phase>('prompt');
  const [percent, setPercent] = useState(0);
  const [transferred, setTransferred] = useState(0);
  const [total, setTotal] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Live session state. The start-up check can resolve seconds late (slow
  // network); by then the user may have clocked in, and we must not interrupt.
  const displayStateRef = useRef(displayState);
  useEffect(() => { displayStateRef.current = displayState; }, [displayState]);

  // Read inside the updater listeners, which are registered once and outlive a
  // restart → auto upgrade.
  const deliveryRef = useRef(delivery);
  useEffect(() => { deliveryRef.current = delivery; }, [delivery]);

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
    // `mode` is the latch — EXCEPT on the restart path, which is a "the check
    // hasn't answered yet" placeholder rather than a decision. Letting it
    // re-evaluate is what makes the `updater:available` listener above worth
    // anything: without this, the late answer arrived, bumped `availableTick`,
    // and was thrown away right here.
    if (mode !== 'none' && delivery !== 'restart') return;
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
        // Clearing `mode` matters on the provisional restart path: disarming the
        // config is the emergency lever for a fleet stuck behind a compulsory
        // prompt, and it has to release them without a relaunch (a stuck user is
        // clocked out, so they re-evaluate on the next `updater:available` and
        // are reloaded by `DeploymentRefresher` regardless).
        const cfg = resolvePlatformUpdate(config, platform);
        if (!cfg) { setMode('none'); return; }

        // A build too old to report its version can't be compared — force it.
        // Self-resolving: once updated, getVersion exists and this never fires.
        if (appVersion && compareSemver(appVersion, cfg.latestVersion) >= 0) { setMode('none'); return; } // up to date
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
  }, [mode, delivery, isHydrating, displayState, availableTick]);

  /**
   * Re-read the shell's start-up check. Returns true once it has an answer, and
   * moves the banner onto the auto path in place — the user is looking at the
   * restart dialog and it turns into a working Download button under them.
   */
  const pollPending = useCallback(async (): Promise<boolean> => {
    const updater = window.electronAPI?.updater;
    if (!updater?.getPending || !updater.download) return false;
    const pending = await updater.getPending().catch(() => null);
    if (!pending) return false;
    setTarget(prev => pending.version ?? prev);
    setCheckError(null);
    setPhase('prompt');
    setDelivery('auto');
    return true;
  }, []);

  // The restart path polls itself out of existence. A null `getPending()` at
  // decision time is nearly always a check still in flight, not a check that
  // found nothing — so keep asking for a bounded window instead of sending the
  // user off to relaunch into the very same race.
  useEffect(() => {
    if (mode === 'none' || delivery !== 'restart') return;
    const updater = window.electronAPI?.updater;
    if (!updater?.getPending || !updater.download) return;

    let cancelled = false;
    let waited = 0;
    let timer: ReturnType<typeof setInterval> | null = null;
    setPollExhausted(false);

    const tick = async () => {
      const found = await pollPending();
      if (cancelled || found) return;
      waited += RESTART_POLL_INTERVAL_MS;
      if (waited < RESTART_POLL_WINDOW_MS) return;
      if (timer) clearInterval(timer);
      setPollExhausted(true);
    };

    void tick(); // don't make the user wait out the first interval
    timer = setInterval(tick, RESTART_POLL_INTERVAL_MS);
    return () => { cancelled = true; if (timer) clearInterval(timer); };
  }, [mode, delivery, pollNonce, pollPending]);

  const recheck = useCallback(async () => {
    setChecking(true);
    setCheckError(null);
    try {
      // Only present in shells built after this fix. An older shell checks
      // GitHub once at launch and cannot be asked again, so there all we can do
      // is re-read the answer — which is still strictly better than the old
      // advice, because the answer usually did arrive, just too late.
      await window.electronAPI?.updater?.check?.();
      await pollPending();
    } finally {
      setChecking(false);
      setPollNonce(n => n + 1); // fresh polling window either way
    }
  }, [pollPending]);

  // Updater events. Registered on EVERY delivery path, not just `auto`:
  //
  //  - `updater:status` errors are the only evidence a user ever gets that the
  //    shell's check failed. Main only `console.error`s it, and this effect used
  //    to bail before registering unless the auto path had already been chosen —
  //    so an app that launched before the network was up showed a restart
  //    dialog that silently described the wrong problem forever.
  //  - The restart path upgrades to `auto` underneath these listeners, so the
  //    download handlers have to already be in place.
  //
  // Progress and before-install can only fire once a download is running, and
  // only the auto path can start one, so registering them early costs nothing.
  useEffect(() => {
    if (mode === 'none') return;
    const updater = window.electronAPI?.updater;
    if (!updater) return;

    updater.onProgress(p => {
      setPercent(p.percent);
      setTransferred(p.transferred);
      setTotal(p.total);
    });
    updater.onStatus(s => {
      if (s.status !== 'error') return;
      if (deliveryRef.current !== 'auto') {
        // Not a failed download — no download has been started. This is the
        // start-up check itself failing, which the restart copy reports.
        setCheckError(s.message ?? null);
        return;
      }
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
  }, [mode]);

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

  // macOS with nothing pending YET. No download link on this platform, but there
  // is an in-app action after all — re-reading the check — so the copy stops
  // promising the one thing the shell cannot do. `autoDownload` and
  // `autoInstallOnAppQuit` are both false in main.js: a relaunch never installs
  // anything on its own, it only re-runs the check that we are already polling.
  const needsRestart = delivery === 'restart';
  const restartLine = checkError
    ? `Bluu Backend couldn’t reach the update server (${checkError}). Check your connection, then press Check again.`
    : pollExhausted
      ? 'Bluu Backend hasn’t been able to reach the update server. Check your connection and press Check again — if it keeps failing, quit and reopen the app.'
      : 'Bluu Backend is contacting the update server. This can take a moment on a slow connection.';

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

          {/* The restart path gets a real action. It used to render no footer at
              all, on the reasoning that every remedy lived outside the app —
              but that left a compulsory dialog with no reachable way forward,
              and the remedy it named (relaunch) does not install anything.
              Re-reading the check is something the app can genuinely do. */}
          {needsRestart ? (
            <AlertDialogFooter>
              <AlertDialogAction
                disabled={checking}
                onClick={(e) => { e.preventDefault(); void recheck(); }}
              >
                {checking
                  ? <><Loader2 className="size-4 animate-spin" />Checking…</>
                  : <><RefreshCw className="size-4" />Check again</>}
              </AlertDialogAction>
            </AlertDialogFooter>
          ) : (
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
          <div className="space-y-3">
            <p className="flex items-start gap-2 text-xs text-muted-foreground">
              <RefreshCw className="mt-0.5 size-4 shrink-0" />
              {restartLine}
            </p>
            <Button size="sm" disabled={checking} onClick={() => void recheck()}>
              {checking
                ? <><Loader2 className="size-4 animate-spin" />Checking…</>
                : <><RefreshCw className="size-4" />Check again</>}
            </Button>
          </div>
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
