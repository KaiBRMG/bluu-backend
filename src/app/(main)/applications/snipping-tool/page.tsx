'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ImageUpscale, Upload } from 'lucide-react';
import { toast } from 'sonner';
import AppLayout from '@/components/AppLayout';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { auth } from '@/firebase-config';
import { useUserData } from '@/hooks/useUserData';
import { useViewerTimezone } from '@/hooks/useViewerTimezone';
import { copyText } from '@/lib/copyText';
import {
  SNIP_MIC_MIN_APP_VERSION,
  SNIP_VIDEO_MIN_APP_VERSION,
  SNIPPING_TOOL_MIN_APP_VERSION,
  formatSnipShortcut,
  resolveSnipSettings,
  snipExpiryLabel,
  snipRetentionLabel,
} from '@/lib/snips';
import { importSnip } from '@/lib/snipUpload';
import { meetsMinVersion } from '@/lib/appVersion';
import { useAppVersion } from '@/hooks/useAppVersion';
import type { SnipPage, SnipRow } from '@/types/snips';
import { PendingUploads } from './_components/PendingUploads';
import { SnipCard } from './_components/SnipCard';
import { SnipDetailsDialog } from './_components/SnipDetailsDialog';
import { SnipImportDialog } from './_components/SnipImportDialog';
import { SnipSettingsPopover } from './_components/SnipSettingsPopover';

/**
 * Snipping Tool — the library.
 *
 * **Capture does not happen here.** The shortcut and the tray item are native
 * and work with no window open (see `SnipController` and the snip section of
 * `electron/main.js`); this page is where the results live, where links are
 * copied, and where the settings that arm those native surfaces are changed. The
 * "New Snip" button is a convenience for a user who is already looking at it,
 * not the primary path.
 */
/**
 * What a user on too old a shell sees instead of the library.
 *
 * It is a whole-page state rather than a disabled button because *nothing* here
 * works on an old build: the shortcut cannot be armed, the tray item cannot be
 * planted, and New Snip has no IPC to call. Showing a grid of snips they can
 * still copy links from would be defensible, but it would also be a page that
 * silently does a fraction of what its own description promises.
 *
 * Quiet, per DESIGN.md: one line of explanation, no illustration, no box around
 * it. The version is stated because "update the app" is unactionable if you
 * cannot tell whether you already did.
 */
function UpdateRequired({ version }: { version: string | null }) {
  return (
    <div className="max-w-xl">
      <h1 className="mb-2 text-2xl font-bold tracking-tight">Snipping Tool</h1>
      <p className="text-sm text-zinc-400">
        This needs desktop app version{' '}
        <span className="tabular-nums text-zinc-300">{SNIPPING_TOOL_MIN_APP_VERSION}</span> or newer
        {version ? (
          <>
            {' '}— you are on{' '}
            <span className="tabular-nums text-zinc-300">{version}</span>.
          </>
        ) : (
          '.'
        )}{' '}
        Screen capture runs in the desktop app itself, so it cannot arrive with a
        page refresh.
      </p>
      <p className="mt-3 text-sm text-zinc-400">
        You will be prompted to update when the build is released. Quit and
        reopen the app if you have already installed it.
      </p>
    </div>
  );
}

export default function SnippingToolPage() {
  const { userData } = useUserData();
  const { version, status: versionStatus } = useAppVersion();
  const { timezone } = useViewerTimezone();

  const [snips, setSnips] = useState<SnipRow[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [importing, setImporting] = useState(false);
  // One dialog for the whole grid, holding the row being edited — not one
  // mounted per card, which on a 24-cell page would be 24 `Dialog` portals for
  // a surface at most one of them ever opens.
  const [editing, setEditing] = useState<SnipRow | null>(null);
  // Seeded from the user agent rather than defaulting to `other`: the IPC answer
  // arrives a tick later, and until it does a Mac would render the shortcut as
  // "Ctrl + Shift + S" in the page's own description — wrong, and prominent.
  const [platform, setPlatform] = useState<'darwin' | 'other'>(() =>
    typeof navigator !== 'undefined' && /Mac/i.test(navigator.userAgent) ? 'darwin' : 'other',
  );

  // Settings ride down on the `users/{uid}` snapshot, which is already open — no
  // fetch, and a change made in another window arrives live. Only the *save*
  // goes over HTTP.
  //
  // DERIVED, not mirrored into state. `users/{uid}` is rewritten by presence
  // every ten minutes, so an effect keyed on the snapshot would re-set identical
  // state on a timer (rule 9i's dependency trap, in its re-render form). The
  // popover keeps its own optimistic draft for the instant a save is in flight;
  // this is the authority it reconciles back to.
  const settings = useMemo(
    () => resolveSnipSettings(userData?.snipSettings),
    [userData?.snipSettings],
  );

  useEffect(() => {
    let cancelled = false;
    window.electronAPI?.app?.getPlatform?.()
      .then(p => { if (!cancelled) setPlatform(p === 'darwin' ? 'darwin' : 'other'); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Two guards, because the two kinds of load want opposite answers to "one is
  // already running". A *next page* stands down — the observer fires more than
  // once for the same sentinel and a second request would fetch the same rows.
  // A *reload* preempts, so Try again is never a click that does nothing; the
  // sequence stamp is what stops the abandoned response landing on top of it.
  const inFlight = useRef(false);
  const sequence = useRef(0);

  const loadPage = useCallback(async (from: string | null) => {
    if (from !== null && inFlight.current) return;
    const stamp = from === null ? ++sequence.current : sequence.current;
    inFlight.current = true;
    if (from !== null) setLoadingMore(true);

    try {
      const idToken = await auth.currentUser?.getIdToken();
      if (!idToken) throw new Error('Session expired — sign in again.');
      const url = from ? `/api/snips?cursor=${encodeURIComponent(from)}` : '/api/snips';
      const res = await fetch(url, { headers: { Authorization: `Bearer ${idToken}` } });
      if (!res.ok) throw new Error(from ? 'Could not load more snips' : 'Could not load your snips');
      const page = (await res.json()) as SnipPage;
      if (stamp !== sequence.current) return;

      setSnips(prev => {
        if (from === null || !prev) return page.snips;
        // A capture taken mid-scroll is already at the top of the list; the
        // page that follows must not put a second copy of it further down.
        const seen = new Set(prev.map(s => s.id));
        return [...prev, ...page.snips.filter(s => !seen.has(s.id))];
      });
      setCursor(page.nextCursor);
      if (page.total !== null) setTotal(page.total);
      setError(null);
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : from
            ? 'Could not load more snips'
            : 'Could not load your snips';
      if (stamp !== sequence.current) return;
      setError(message);
      // A failed *next* page keeps the rows already on screen — only the first
      // one has nothing to preserve.
      if (from === null) setSnips([]);
    } finally {
      // Only the current attempt clears the flag — a preempted one finishing
      // late must not reopen the door on the request that replaced it.
      if (stamp === sequence.current) {
        inFlight.current = false;
        setLoadingMore(false);
      }
    }
  }, []);

  const load = useCallback(() => loadPage(null), [loadPage]);

  useEffect(() => { load(); }, [load]);

  // The next page arrives before the user reaches the end of this one: the
  // sentinel sits under the grid with 600px of lead, so scrolling is continuous
  // rather than punctuated by a wait. It is attached to the same element the
  // "Load more" button lives in, which is what keeps the keyboard path — and a
  // browser with no observer — on exactly one control instead of a hidden one.
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  // `total` is what lets an exactly-divisible library stop cleanly: without it
  // a full last page always leaves a cursor, and the grid ends on one request
  // that returns nothing.
  const hasMore =
    cursor !== null && snips !== null && (total === null || snips.length < total);
  const canLoadMore = hasMore && !error;
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !canLoadMore || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      entries => { if (entries.some(e => e.isIntersecting)) loadPage(cursor); },
      { rootMargin: '600px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [canLoadMore, cursor, loadPage]);

  // A capture taken while this page is open belongs at the top of it
  // immediately. `SnipController` owns the upload wherever the user is, so it
  // announces the result rather than this page polling for it.
  useEffect(() => {
    const onCreated = (event: Event) => {
      const snip = (event as CustomEvent<SnipRow>).detail;
      if (!snip?.id) return;
      setSnips(prev => {
        if (!prev) return [snip];
        const existing = prev.filter(s => s.id !== snip.id);
        if (existing.length === prev.length) setTotal(t => (t === null ? t : t + 1));
        return [snip, ...existing];
      });
    };
    window.addEventListener('bluu:snip-created', onCreated);
    return () => window.removeEventListener('bluu:snip-created', onCreated);
  }, []);

  const startCapture = useCallback(async () => {
    const api = window.electronAPI?.snip;
    if (!api?.start) {
      toast.error('Update the desktop app to use the Snipping Tool.');
      return;
    }
    setCapturing(true);
    try {
      const result = await api.start();
      if (result?.error === 'recording') {
        // Not a failure — the tool is busy doing the other thing it does, and
        // the control bar for it is on screen right now.
        toast.error('A recording is already running. Stop it first.');
      } else if (!result?.success && result?.error !== 'busy') {
        // 'busy' is a second click while the overlay is already up — the tool
        // is working, so reporting a failure would be wrong.
        toast.error('Could not start a snip.');
      }
    } catch {
      toast.error('Could not start a snip.');
    } finally {
      setCapturing(false);
    }
  }, []);

  // The description is the EXPIRY, never the URL. Two reasons, and the second
  // is the load-bearing one:
  //
  //  1. The expiry is what the user needs at the moment they are about to hand
  //     the link over — "Deletes tomorrow" changes whether they send it.
  //  2. The share URL contains the share token, and the token IS the access
  //     control (see the spoke). This is a *screenshot tool*: a secret rendered
  //     on screen for several seconds is a secret that ends up inside somebody's
  //     next capture or screen share. The rule against printing a token in a log
  //     or an error message applies just as much to a toast.
  //
  // **This copies whether or not auto-copy is on.** That setting governs what
  // happens automatically once an upload finishes; this button is the user
  // asking, and a preference about unattended behaviour must never disable an
  // explicit request. It is also what makes turning auto-copy off safe — the
  // link stays one click away on every card.
  const copyLink = useCallback(async (snip: SnipRow) => {
    const copied = await copyText(snip.shareUrl);
    if (copied) {
      toast.success('Link copied — anyone with it can view', {
        description: snip.expiresAt ? snipExpiryLabel(snip.expiresAt) : undefined,
      });
    } else {
      toast.error('Could not copy the link');
    }
  }, []);

  /** Writes a title and a description onto a snip the user already has. */
  const saveDetails = useCallback(
    async (snip: SnipRow, values: { title: string; description: string }) => {
      const idToken = await auth.currentUser?.getIdToken();
      if (!idToken) throw new Error('Session expired — sign in again.');
      const res = await fetch(`/api/snips/${snip.id}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      if (!res.ok) {
        let message = 'Could not save those details';
        // Guarded: a non-JSON error body (an HTML 500, a proxy timeout) would
        // otherwise throw a SyntaxError that replaces the real failure.
        try {
          const body = await res.json();
          if (typeof body?.error === 'string' && body.error) message = body.error;
        } catch {}
        throw new Error(message);
      }
      // The SERVER's row, not the draft — its normalisers decide what "empty"
      // is, and a title of three spaces has to come back as absent rather than
      // sit in the grid as a saved value.
      const { snip: saved } = (await res.json()) as { snip: SnipRow };
      setSnips(prev => (prev ? prev.map(s => (s.id === saved.id ? saved : s)) : prev));
      toast.success('Details saved');
    },
    [],
  );

  /**
   * Import — an image the user already has, given the same treatment as a
   * capture: a reservation, a share token, a retention stamp and a card.
   *
   * The new row is prepended rather than the list reloaded, exactly as a fresh
   * capture is (`bluu:snip-created` above) — a reload would re-fetch a page the
   * user is already looking at to move one row to the top of it (rule 9i).
   */
  const handleImport = useCallback(
    async (
      file: File,
      dimensions: { width: number; height: number },
      onProgress?: (fraction: number) => void,
    ) => {
      const idToken = await auth.currentUser?.getIdToken();
      if (!idToken) throw new Error('Session expired — sign in again.');
      const snip = await importSnip(idToken, file, dimensions, onProgress);

      setSnips(prev => (prev ? [snip, ...prev] : [snip]));
      setTotal(t => (t === null ? t : t + 1));

      // Same rule the capture path follows: the link goes on the clipboard
      // only if the user has auto-copy on, and the toast never claims a copy
      // it did not make.
      const copied = settings.autoCopyEnabled ? await copyText(snip.shareUrl) : false;
      toast.success(copied ? 'Imported — link copied' : 'Image imported', {
        description: copied
          ? snip.expiresAt
            ? snipExpiryLabel(snip.expiresAt)
            : undefined
          : 'Use the link button on its card to copy the share link.',
      });
    },
    [settings.autoCopyEnabled],
  );

  const removeSnip = useCallback(async (snip: SnipRow) => {
    try {
      const idToken = await auth.currentUser?.getIdToken();
      if (!idToken) throw new Error('Session expired — sign in again.');
      const res = await fetch(`/api/snips/${snip.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${idToken}` },
      });
      if (!res.ok) throw new Error('Could not delete that snip');
      setSnips(prev => (prev ? prev.filter(s => s.id !== snip.id) : prev));
      setTotal(t => (t === null ? t : Math.max(0, t - 1)));
      toast.success('Snip deleted');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not delete that snip');
    }
  }, []);

  // The version floor, checked here and not only in the sidebar: this route is
  // reachable by deep link, by the completion notification's `actionUrl`, and by
  // typing it. `versionStatus` is what keeps the refusal from flashing for
  // everyone during the tick before the IPC answer lands — `meetsMinVersion`
  // treats "unknown" as failing, which is right for a decision and wrong to
  // render. An old shell that cannot even answer resolves to `null`, which
  // fails the floor, which is the correct outcome.
  const tooOld = versionStatus === 'resolved' && !meetsMinVersion(version, SNIPPING_TOOL_MIN_APP_VERSION);

  // A SECOND floor, for the video mode only — see `SNIP_VIDEO_MIN_APP_VERSION`.
  // Deliberately not folded into `tooOld`: a user on 0.13.x keeps their whole
  // library and every image capture, and is told one line about the mode they
  // are missing rather than being shut out of a page that works.
  const canRecord =
    versionStatus === 'resolved' && meetsMinVersion(version, SNIP_VIDEO_MIN_APP_VERSION);

  // A THIRD floor, for narration alone — see `SNIP_MIC_MIN_APP_VERSION`. Kept
  // separate from `canRecord` for the same reason that one is separate from
  // `tooOld`: a 0.14.x user keeps screen recording and is told one line about
  // the audio source they are missing, rather than losing a mode that works.
  const canNarrate =
    versionStatus === 'resolved' && meetsMinVersion(version, SNIP_MIC_MIN_APP_VERSION);

  if (versionStatus === 'checking') {
    // Shaped to the page it becomes — heading, description lines, then the
    // grid — so resolving the version swaps content in rather than reflowing
    // the whole page around a lone bar.
    return (
      <AppLayout>
        <div className="max-w-6xl">
          <Skeleton className="h-8 w-48 rounded-md" />
          <Skeleton className="mt-2 h-4 w-80 rounded-md" />
          <Skeleton className="mt-1.5 h-4 w-64 rounded-md" />
          <div className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-[13.5rem] rounded-xl" />
            ))}
          </div>
        </div>
      </AppLayout>
    );
  }

  if (tooOld) {
    return (
      <AppLayout>
        <UpdateRequired version={version} />
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="max-w-6xl">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="mb-2 text-2xl font-bold tracking-tight">Snipping Tool</h1>
            <p className="text-sm text-zinc-400">
              {settings.shortcutEnabled ? (
                <>
                  Capture any part of your screen with{' '}
                  <span className="font-mono text-zinc-300">
                    {formatSnipShortcut(settings.shortcut, platform)}
                  </span>
                  .{' '}
                  {/* Conditional, because the sentence was a standing promise
                      the Auto-copy setting can now make false — and a
                      description that lies about what the tool just did is
                      worse than one that says less. */}
                  {settings.autoCopyEnabled
                    ? 'The link is copied to your clipboard after upload.'
                    : 'Copy each link from its card — auto-copy is off.'}
                </>
              ) : (
                'Capture any part of your screen and share it with a link.'
              )}
            </p>
            {/* Shown ONLY to a shell too old to record — there is deliberately
                no second description line for everyone else (DESIGN.md: one).

                It has to stay for this case: `SNIP_VIDEO_MIN_APP_VERSION` is a
                separate floor from the page's own, so a 0.13.x user keeps their
                whole library and simply never gets the Image/Video toggle. With
                nothing said here, the toggle is just absent and there is no
                surface anywhere that explains why. */}
            {!canRecord && (
              <p className="mt-1.5 text-sm text-zinc-400">
                Screen recording needs desktop app version{' '}
                <span className="tabular-nums text-zinc-300">
                  {SNIP_VIDEO_MIN_APP_VERSION}
                </span>{' '}
                or newer. Image capture works as it always has.
              </p>
            )}
            {/* Mutually exclusive with the line above, so the header never
                carries two version notices: a shell too old to record is not
                also told what it is missing inside recording. Everything else
                in this release — auto-copy, titles, Import, the shared player —
                needs no build and is deliberately not mentioned here. */}
            {canRecord && !canNarrate && (
              <p className="mt-1.5 text-sm text-zinc-400">
                Recording with your microphone needs desktop app version{' '}
                <span className="tabular-nums text-zinc-300">
                  {SNIP_MIC_MIN_APP_VERSION}
                </span>{' '}
                or newer. Everything else here works as it does now.
              </p>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <Button onClick={startCapture} disabled={capturing}>
              <ImageUpscale className="size-4" />
              New Snip
            </Button>
            {/* Secondary to New Snip, and beside it rather than in the settings
                popover: importing is something a user *does* on this page, not
                a preference they set. `outline` keeps the primary action the
                one the page is named after. */}
            <Button variant="outline" onClick={() => setImporting(true)}>
              <Upload className="size-4" />
              Import
            </Button>
            <SnipSettingsPopover settings={settings} platform={platform} />
          </div>
        </div>

        {/* Above the grid, not in it. A recording that never uploaded is a
            state the user has to resolve, not a row to browse — and it is the
            only place the app can say "it is not lost". Renders nothing when
            the queue is empty, which is almost always. */}
        <div className="mt-6">
          <PendingUploads timezone={timezone} />
        </div>

        <div className="mt-6">
          {snips === null ? (
            // Shaped to the grid it becomes, so nothing jumps when the rows land.
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-[13.5rem] rounded-xl" />
              ))}
            </div>
          ) : error && snips.length === 0 ? (
            <div className="flex flex-col items-start gap-2">
              <p className="text-sm text-zinc-400">{error}</p>
              <Button variant="outline" size="sm" onClick={load}>Try again</Button>
            </div>
          ) : snips.length === 0 ? (
            // One quiet line, no box — and it names the way out of the state
            // rather than just describing it.
            <p className="text-sm text-zinc-400">
              No snips yet.{' '}
              {settings.shortcutEnabled
                ? <>Press <span className="font-mono text-zinc-300">{formatSnipShortcut(settings.shortcut, platform)}</span> anywhere to take one.</>
                : 'Use New Snip above to take one.'}
            </p>
          ) : (
            <>
              {/* A list, not a bag of divs: a screen reader announces how many
                  snips are on the page, which is the one thing the grid's
                  visual layout conveys for free and its markup otherwise
                  would not. */}
              <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {snips.map(snip => (
                  <SnipCard
                    key={snip.id}
                    snip={snip}
                    timezone={timezone}
                    onCopy={copyLink}
                    onDelete={removeSnip}
                    onEdit={setEditing}
                  />
                ))}
                {/* The next page arriving, in the shape it will arrive in. The
                    same skeleton as the first load, so growing the grid and
                    filling it read as one behaviour. */}
                {loadingMore && Array.from({ length: 3 }).map((_, i) => (
                  <li key={`pending-${i}`} aria-hidden="true">
                    <Skeleton className="h-[13.5rem] rounded-xl" />
                  </li>
                ))}
              </ul>

              {/* The observer's target and the keyboard's control are the same
                  element on purpose. Scrolling loads the next page before the
                  button is ever reached; a user who tabs, or a browser without
                  an observer, gets a real control rather than a dead sentinel. */}
              <div ref={sentinelRef} className="mt-4 flex flex-wrap items-center gap-3">
                {error ? (
                  <>
                    <p className="text-sm text-zinc-400">{error}</p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => { setError(null); loadPage(cursor); }}
                    >
                      Try again
                    </Button>
                  </>
                ) : hasMore && !loadingMore ? (
                  <Button variant="outline" size="sm" onClick={() => loadPage(cursor)}>
                    Load more
                  </Button>
                ) : null}

                {/* The live region wraps the COUNT only. It used to wrap the
                    retention clause too, so every appended page re-announced
                    the whole sentence — including a standing policy note that
                    has not changed and is not news. */}
                <p className="text-xs text-zinc-400">
                  <span aria-live="polite">
                    {total !== null && total > snips.length ? (
                      <>
                        Showing <span className="tabular-nums">{snips.length}</span> of{' '}
                        <span className="tabular-nums">{total}</span> snips
                      </>
                    ) : (
                      <>
                        <span className="tabular-nums">{total ?? snips.length}</span>
                        {(total ?? snips.length) === 1 ? ' snip' : ' snips'}
                      </>
                    )}
                  </span>
                  {/* Names the value instead of pointing at the popover: the
                      reader should not have to open a panel to learn what the
                      sentence is telling them. */}
                  {settings.retention !== 'never' &&
                    ` · deleted automatically after ${snipRetentionLabel(settings.retention)}`}
                </p>
              </div>
            </>
          )}
        </div>
      </div>

      <SnipImportDialog
        open={importing}
        onOpenChange={setImporting}
        onImport={handleImport}
      />
      {/* `editing` is both the open flag and the payload: closing clears the
          row, so there is no way for the dialog to be open with nothing in it. */}
      <SnipDetailsDialog
        snip={editing}
        open={editing !== null}
        onOpenChange={open => { if (!open) setEditing(null); }}
        onSave={saveDetails}
      />
    </AppLayout>
  );
}
