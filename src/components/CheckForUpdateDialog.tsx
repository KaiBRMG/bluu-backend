'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, Download, Loader2, RefreshCw, TriangleAlert } from 'lucide-react';
import { getAppInfo } from '@/lib/appVersion';
import { compareSemver } from '@/lib/semver';
import { fetchLatestRelease } from '@/lib/updateCheck';
import { APP_UPDATE, fetchAppUpdateConfig } from '@/lib/appUpdateConfig';
import { setUpdateInFlight } from '@/lib/updateInFlight';
import { useTimeTrackingContext } from '@/contexts/TimeTrackingContext';
import { useAuth } from '@/components/AuthProvider';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

/**
 * **The user-initiated update check** — the "Check for Update" item in the user
 * menu. Always opens, on both platforms, and always ends in a definite answer.
 *
 * ## Why this is not `UpdateAvailableBanner`
 *
 * That component is a **push**: `APP_UPDATE` decides who is nudged, it only ever
 * appears while the user is clocked out, and a platform it does not target sees
 * nothing at all. It answers "is anybody being told to update?".
 *
 * This is a **pull**, and it answers the question the user actually pressed the
 * button to ask — "am I on the latest version?" — which the config cannot
 * answer. `APP_UPDATE.win` is `null` most of the time; a `null` entry means "we
 * are not nudging Windows", never "there is nothing newer". Reading the config
 * here would tell a Windows user on v0.12.0 that they are current while v0.14.2
 * sits on the releases page. So the fact comes from the **GitHub releases feed**
 * (`/api/app-update/latest`), which is the same thing `electron-updater` reads
 * and the same place the installers are actually uploaded to.
 *
 * `appUpdateConfig.ts` keeps exactly one job after this: **pushing** — forced
 * (`compulsory`) and persistent dismissible prompts. It is not consulted below
 * except for `downloadUrl`, and that is read live rather than from the bundled
 * constant for the usual stale-renderer reason (rule 9c).
 *
 * ## The four outcomes, all of them graceful
 *
 * | Outcome | Shown when |
 * |---|---|
 * | **Up to date** | installed >= latest published release |
 * | **Update available** | installed < latest. Delivery differs per platform, below |
 * | **Couldn't check** | the releases feed was unreachable — never dressed up as "up to date" |
 * | **Not the desktop app** | opened in a browser, where there is nothing to update |
 *
 * An Electron build too old to expose `app.getVersion()` also lands on
 * "couldn't check": with no installed version there is nothing to compare, and
 * claiming either answer would be a guess.
 *
 * ## Delivery follows the same hard platform rule as the banner
 *
 * - **macOS never gets the download link.** `electron-updater` is the only
 *   sanctioned path: a hand reinstall over a running signed app is how users end
 *   up on the wrong architecture (the x64 `.dmg` carries no arch suffix) or on a
 *   build that quietly stops auto-updating. Pressing Check for Update asks the
 *   shell to re-run its GitHub check (`updater.check()`) and then polls
 *   `getPending()`; once the shell answers, the dialog grows a real **Download
 *   and install** button with a progress bar. Until it does, the dialog says so
 *   rather than offering an action that does not exist.
 * - **Windows opens `downloadUrl`** for a hand reinstall, which is how that
 *   platform has always updated (no valid signing cert → no auto-update). There
 *   is no updater at all on Windows — `registerAutoUpdater` returns early — so
 *   every `updater.*` call here is both feature-detected and `catch`-guarded: on
 *   Windows the preload exposes the methods while main registers no handler, and
 *   the `invoke` rejects.
 *
 * ## Interaction with a running shift
 *
 * Checking is always safe and never blocked. **Installing** is not: it restarts
 * the app. The shell's `updater:before-install` handler in `TimeTrackingContext`
 * clocks the user out and flushes the session first, so no time is lost — but
 * the user is told that is about to happen before they press the button rather
 * than after.
 */

/** How often the macOS path re-reads the shell's check, and for how long. */
const PENDING_POLL_INTERVAL_MS = 1500;
const PENDING_POLL_WINDOW_MS = 45_000;

type Outcome =
  | 'checking'       // the releases feed hasn't answered yet
  | 'up-to-date'
  | 'available'
  | 'unavailable'    // couldn't reach the feed, or the build can't report a version
  | 'not-desktop';

/** Sub-state of the macOS in-app download. */
type Phase = 'idle' | 'waiting' | 'ready' | 'downloading' | 'installing' | 'error';

function formatMB(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function CheckForUpdateDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { user } = useAuth();
  const { displayState } = useTimeTrackingContext();

  const [outcome, setOutcome] = useState<Outcome>('checking');
  const [current, setCurrent] = useState<string | null>(null);
  const [latest, setLatest] = useState<string | null>(null);
  const [platform, setPlatform] = useState<string | null>(null);
  const [downloadUrl, setDownloadUrl] = useState(APP_UPDATE.downloadUrl);

  const [phase, setPhase] = useState<Phase>('idle');
  const [pollExhausted, setPollExhausted] = useState(false);
  const [percent, setPercent] = useState(0);
  const [transferred, setTransferred] = useState(0);
  const [total, setTotal] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Bumped on every press of Check again — a fresh check and a fresh polling
  // window, without the effects having to share a "should I re-run" flag.
  const [nonce, setNonce] = useState(0);
  const runningRef = useRef(false);
  // Read by the polling effect below, which must NOT depend on `phase`: it sets
  // `phase` itself, so a `phase` dependency would tear down and restart its own
  // interval on every transition it caused.
  const phaseRef = useRef<Phase>('idle');
  useEffect(() => { phaseRef.current = phase; }, [phase]);

  const isMac = platform === 'darwin';

  // ── The check itself ────────────────────────────────────────────────
  // Runs on every open and on every "Check again". Two independent questions,
  // asked in parallel: what is installed (IPC) and what has been released (HTTP).
  useEffect(() => {
    if (!open) return;
    if (runningRef.current) return;
    runningRef.current = true;

    setOutcome('checking');
    setPollExhausted(false);
    setErrorMsg(null);
    // A download already in flight must survive a re-check — re-reading the feed
    // says nothing about the bytes the main process is still pulling.
    setPhase(p => (p === 'downloading' || p === 'installing' ? p : 'idle'));

    (async () => {
      try {
        const api = typeof window !== 'undefined' ? window.electronAPI : undefined;
        if (!api?.isElectron) {
          setOutcome('not-desktop');
          return;
        }

        const [{ appVersion, platform: os }, release] = await Promise.all([
          getAppInfo(),
          fetchLatestRelease(),
        ]);
        setCurrent(appVersion);
        setPlatform(os);
        setLatest(release.version);

        // No answer from the feed, or a build too old to say what it is: either
        // way nothing can be compared, and "up to date" would be a guess.
        if (release.status !== 'ok' || !release.version || !appVersion) {
          setOutcome('unavailable');
          return;
        }

        if (compareSemver(appVersion, release.version) >= 0) {
          setOutcome('up-to-date');
          return;
        }

        // Behind. The live config supplies only the Windows landing page — the
        // decision that an update exists was made from the releases feed above,
        // never from the policy.
        const idToken = user ? await user.getIdToken().catch(() => null) : null;
        const config = await fetchAppUpdateConfig(idToken);
        setDownloadUrl(config.downloadUrl);
        setOutcome('available');
      } finally {
        runningRef.current = false;
      }
    })();
  }, [open, nonce, user]);

  // ── macOS: ask the shell to look, then poll for its answer ──────────
  // `electron-updater` is what actually delivers the bytes, and its check is a
  // couple of GitHub round trips. `getPending()` reading null is "not yet", not
  // "nothing found" — the releases feed has already established this user is
  // behind — so poll for a bounded window rather than offering a dead button.
  useEffect(() => {
    if (!open || outcome !== 'available' || !isMac) return;
    // A download in flight is not re-checked — the shell is already delivering.
    if (phaseRef.current === 'downloading' || phaseRef.current === 'installing') return;

    const updater = window.electronAPI?.updater;
    const getPending = updater?.getPending;
    if (!getPending || !updater?.download) return;

    let cancelled = false;
    let waited = 0;
    let timer: ReturnType<typeof setInterval> | null = null;

    setPhase('waiting');
    setPollExhausted(false);
    // Optional on older shells, and absent entirely on Windows — never called
    // without a catch, since there the invoke rejects with "no handler".
    void updater.check?.()?.catch(() => {});

    const tick = async () => {
      const pending = await getPending().catch(() => null);
      if (cancelled) return;
      if (pending) {
        if (timer) clearInterval(timer);
        setLatest(prev => pending.version ?? prev);
        setPhase('ready');
        return;
      }
      waited += PENDING_POLL_INTERVAL_MS;
      if (waited < PENDING_POLL_WINDOW_MS) return;
      if (timer) clearInterval(timer);
      setPollExhausted(true);
    };

    void tick();
    timer = setInterval(tick, PENDING_POLL_INTERVAL_MS);
    return () => { cancelled = true; if (timer) clearInterval(timer); };
    // `phase` is deliberately absent — see `phaseRef`.
  }, [open, outcome, isMac, nonce]);

  // ── Updater events ──────────────────────────────────────────────────
  // Registered once, for the life of the component, and deliberately never
  // removed: `removeListeners()` is `removeAllListeners` on channels
  // `TimeTrackingContext` also uses, so cleaning up here would rip out the
  // before-install clock-out flush and lose a user's session data.
  useEffect(() => {
    const updater = window.electronAPI?.updater;
    if (!updater) return;

    updater.onProgress?.(p => {
      setPercent(p.percent);
      setTransferred(p.transferred);
      setTotal(p.total);
    });
    updater.onStatus?.(s => {
      if (s.status !== 'error') return;
      setErrorMsg(s.message ?? null);
      setPhase(p => (p === 'downloading' ? 'error' : p));
      setUpdateInFlight(false); // nothing is running — a reload is safe again
    });
    updater.onBeforeInstall?.(() => {
      setPhase('installing');
      setUpdateInFlight(true);
    });
  }, []);

  const recheck = useCallback(() => setNonce(n => n + 1), []);

  const startDownload = useCallback(() => {
    setErrorMsg(null);
    setPercent(0);
    setPhase('downloading');
    // Hold off `DeploymentRefresher`: a reload now would drop this dialog while
    // the main process kept downloading. Cleared again if the download errors.
    setUpdateInFlight(true);
    window.electronAPI?.updater?.download?.();
  }, []);

  const openDownload = useCallback(() => {
    // target=_blank is intercepted by the shell's setWindowOpenHandler → opens
    // in the external browser.
    window.open(downloadUrl, '_blank', 'noopener,noreferrer');
  }, [downloadUrl]);

  // An install restarts the app, so a running shift is ended for the user (the
  // shell's before-install handler clocks them out and flushes first). Say so
  // before the button, not after.
  const willEndShift = displayState !== 'clocked-out';

  // A download or install owns the dialog: closing it would leave the main
  // process pulling bytes with nothing on screen saying so.
  const locked = phase === 'downloading' || phase === 'installing';

  return (
    <Dialog open={open} onOpenChange={next => { if (!locked) onOpenChange(next); }}>
      <DialogContent showCloseButton={!locked} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {outcome === 'checking' && <Loader2 className="size-4 animate-spin" />}
            {outcome === 'up-to-date' && <CheckCircle2 className="size-4 text-emerald-400" />}
            {outcome === 'available' && <Download className="size-4" />}
            {outcome === 'unavailable' && <TriangleAlert className="size-4 text-amber-400" />}
            {outcome === 'checking' && 'Checking for updates…'}
            {outcome === 'up-to-date' && 'You’re up to date'}
            {outcome === 'available' && 'Update available'}
            {outcome === 'unavailable' && 'Couldn’t check for updates'}
            {outcome === 'not-desktop' && 'Desktop app only'}
          </DialogTitle>
          <DialogDescription>
            {outcome === 'checking' && 'Comparing your installed version with the latest release.'}
            {outcome === 'up-to-date' &&
              `Bluu Backend v${current} is the latest released version.`}
            {outcome === 'available' &&
              (current
                ? `You’re on v${current}. v${latest} has been released.`
                : `v${latest} has been released.`)}
            {outcome === 'unavailable' &&
              (current
                ? `You’re on v${current}, but the release feed couldn’t be reached. Check your connection and try again.`
                : 'The release feed couldn’t be reached, and this build can’t report its own version. Check your connection and try again.')}
            {outcome === 'not-desktop' &&
              'Updates apply to the Bluu Backend desktop app. There’s nothing to update in a browser.'}
          </DialogDescription>
        </DialogHeader>

        {/* macOS, update found, waiting on the shell's own check. */}
        {outcome === 'available' && isMac && phase === 'waiting' && (
          <p className="text-sm text-muted-foreground">
            {pollExhausted
              ? 'The updater hasn’t been able to reach GitHub yet. Try again in a moment — your work is unaffected in the meantime.'
              : 'Preparing the download…'}
          </p>
        )}

        {/* macOS, ready to install — the only platform offered an in-app update. */}
        {outcome === 'available' && isMac && phase === 'ready' && willEndShift && (
          <p className="text-sm text-amber-400">
            You’re currently clocked in. Installing will clock you out and restart the
            app — your session is saved first.
          </p>
        )}

        {outcome === 'available' && isMac && phase === 'downloading' && (
          <div className="space-y-2">
            <Progress value={percent} />
            <p className="text-xs text-muted-foreground">
              {total
                ? `${formatMB(transferred)} of ${formatMB(total)} · ${Math.round(percent)}%`
                : 'Starting download…'}
            </p>
          </div>
        )}

        {outcome === 'available' && phase === 'installing' && (
          <p className="text-sm text-muted-foreground">
            Saving your session and restarting into the new version…
          </p>
        )}

        {outcome === 'available' && phase === 'error' && (
          <p className="text-sm text-destructive">
            The download failed{errorMsg ? `: ${errorMsg}` : '.'} You can try again.
          </p>
        )}

        {/* Windows, update found. No updater on this platform — a hand reinstall
            is the only path, and it is the one that has always been used here. */}
        {outcome === 'available' && !isMac && (
          <p className="text-sm text-muted-foreground">
            Download the installer and run it. You can keep working until you do —
            quit the app before installing.
          </p>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          {(outcome === 'up-to-date' || outcome === 'unavailable') && (
            <Button variant="outline" onClick={recheck}>
              <RefreshCw className="size-4" />
              Check again
            </Button>
          )}

          {outcome === 'available' && isMac && phase === 'ready' && (
            <Button onClick={startDownload}>
              <Download className="size-4" />
              Download and install
            </Button>
          )}
          {outcome === 'available' && isMac && phase === 'error' && (
            <Button onClick={startDownload}>
              <RefreshCw className="size-4" />
              Try again
            </Button>
          )}
          {outcome === 'available' && isMac && phase === 'waiting' && pollExhausted && (
            <Button variant="outline" onClick={recheck}>
              <RefreshCw className="size-4" />
              Check again
            </Button>
          )}
          {outcome === 'available' && !isMac && (
            <Button onClick={openDownload}>
              <Download className="size-4" />
              Download installer
            </Button>
          )}

          {!locked && (
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
