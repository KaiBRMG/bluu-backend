'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { auth } from '@/firebase-config';
import { useUserData } from '@/hooks/useUserData';
import { copyText } from '@/lib/copyText';
import {
  SNIPPING_TOOL_PAGE_ID,
  formatSnipDuration,
  resolveSnipSettings,
  snipExpiryLabel,
} from '@/lib/snips';
import { uploadSnip, uploadSnipRecording } from '@/lib/snipUpload';
import type { SnipRow } from '@/types/snips';

/**
 * The bridge between the native capture and the app.
 *
 * Mounted once on `(main)/layout.tsx`, renders nothing, and does three things:
 *
 *   1. **Arms the shell.** Pushes `{enabled, trayIconEnabled, shortcutEnabled,
 *      shortcut}` to Electron whenever any of them changes. `enabled` is the
 *      page permission — pushing `false` is how a user who loses the grant has
 *      the tray item and the global shortcut *taken away*, which is the reason
 *      main deliberately never caches this config to disk.
 *   2. **Uploads a capture.** Main hands down the cropped PNG; this uploads it,
 *      puts the link on the clipboard and says so.
 *   3. **Handles the tray's "My Snips"**, which asks the renderer to navigate so
 *      the transition is a normal client-side one.
 *
 * It lives on the layout rather than on the Snipping Tool page because the whole
 * point is that a capture works with no page open — and the upload has to
 * survive the user being in another application entirely.
 */
/**
 * Whether this machine has a Screen Recording permission at all.
 *
 * The user agent rather than the `app:getPlatform` IPC, deliberately: this is
 * read inside a toast callback at the moment a capture has already failed, and
 * an async round-trip there would either delay the toast or race it. A wrong
 * answer costs one button's visibility, not correctness — main has already
 * rewritten the reason for non-macOS, so this is the second belt.
 */
function isMac(): boolean {
  return typeof navigator !== 'undefined' && /Mac/i.test(navigator.userAgent);
}

export default function SnipController() {
  const { userData } = useUserData();
  const router = useRouter();

  // Rule 9i: never key an effect on the snapshot object. `users/{uid}` is
  // rewritten by presence every ten minutes, which would re-arm the shortcut
  // (and re-register it with the OS) on a timer for no reason. Each of these is
  // a primitive, so the effects below fire only when the value actually changes.
  const enabled = !!userData?.permittedPageIds?.includes(SNIPPING_TOOL_PAGE_ID);
  const settings = resolveSnipSettings(userData?.snipSettings);
  const { trayIconEnabled, shortcutEnabled, shortcut, systemAudioEnabled } = settings;

  // ── 1. Arm / disarm the shell ──────────────────────────────────────
  useEffect(() => {
    const api = window.electronAPI?.snip;
    // Feature-detected: a browser has no shell, and an installed build older
    // than this feature has no `snip` bridge (rule 9c). Both are no-ops.
    if (!api?.configure) return;

    api
      .configure({
        enabled,
        trayIconEnabled,
        shortcutEnabled,
        shortcut,
        systemAudioEnabled,
        // Capability negotiation, and it protects the OPPOSITE case to the
        // version floor. The floor keeps a new renderer off an old shell;
        // this keeps a NEW shell from offering Video to an OLD renderer —
        // a page bundle can be weeks older than the app around it (rule 9c),
        // and one with no `onRecorded` listener would let the user record for
        // two minutes and then silently drop the result. Main draws the Video
        // toggle only when this is true.
        supportsRecording: typeof api.onRecorded === 'function',
      })
      .then(result => {
        // `register` returns false when another application already owns the
        // combination. Saying nothing would leave the user pressing a key that
        // belongs to someone else and concluding the feature is broken.
        if (enabled && shortcutEnabled && result?.ok && result.shortcutRegistered === false) {
          toast.error('That snip shortcut is already used by another app. Pick another in Snipping Tool → Settings.');
        }
      })
      .catch(() => {
        // An IPC failure here costs the shortcut, not the app. The in-page
        // "New Snip" button still works.
      });
  }, [enabled, trayIconEnabled, shortcutEnabled, shortcut, systemAudioEnabled]);

  // ── 2. Upload a capture ────────────────────────────────────────────

  // One upload at a time. Main already refuses to open a second set of overlays
  // while one is in flight, but a slow upload and a fast second capture are not
  // the same race — this one is about two toasts fighting over the clipboard.
  const uploadingRef = useRef(false);

  /**
   * Everything after the bytes have landed, shared by both kinds.
   *
   * The link goes on the clipboard the moment the upload lands — that is the
   * deliverable, not the snip itself. `copyText` prefers the main process
   * because `navigator.clipboard` needs the document focused and this window
   * is usually behind whatever the user was looking at.
   *
   * The OS notification is the one that will actually be seen: the app is very
   * likely not the front window, so an in-app toast lands on a surface nobody
   * is looking at. Silent — it confirms, it does not interrupt. Clicking it
   * opens the library.
   *
   * It states the *outcome* rather than the event ("Link copied", not "Snip
   * uploaded"), because the clipboard is the only thing the user needs to act
   * on, and it never claims a copy that did not happen.
   *
   * ## `interactive: false` is for uploads the user did not just ask for
   *
   * Everything above is true of a capture the user *took*: they pressed the
   * shortcut a second ago and the clipboard is the thing they are waiting for.
   * It is all wrong for the background drain, which runs four seconds after
   * every mount and on every `online` event. There, taking the clipboard means
   * silently destroying whatever the user had copied — they did not ask for
   * this upload and are very likely in the middle of something else — and an
   * in-app toast is noise about a queue the library page already lists.
   *
   * So a non-interactive announce writes nothing to the clipboard and raises no
   * toast. It still fires the OS notification, because the user does need to
   * learn the recording finally landed, and it still emits `bluu:snip-created`
   * so an open library page updates.
   *
   * **Never print `shareUrl` in the toast.** The share token IS the access
   * control, and this is a screenshot tool — a secret on screen ends up inside
   * the next capture. The expiry goes there instead: it is the fact the user
   * needs before handing the link over, and it is not a secret.
   */
  const announce = useCallback(
    async (
      snip: SnipRow,
      toastId: string | number | undefined,
      options: { interactive?: boolean } = {},
    ) => {
      const interactive = options.interactive !== false;
      const recording = snip.kind === 'video';
      const noun = recording ? 'Recording' : 'Snip';

      const copied = interactive ? await copyText(snip.shareUrl) : false;

      if (interactive) {
        toast.success(copied ? 'Link copied — anyone with it can view' : `${noun} saved`, {
          id: toastId,
          description: copied
            ? snip.expiresAt
              ? snipExpiryLabel(snip.expiresAt)
              : undefined
            : 'Open Snipping Tool to copy the link.',
        });
      } else if (toastId !== undefined) {
        // Nothing should be left spinning: an automatic pass that borrowed a
        // toast id still has to resolve it.
        toast.dismiss(toastId);
      }

      window.electronAPI?.notifications?.show?.({
        id: `snip-${snip.id}`,
        playSound: false,
        title: copied ? 'Link copied to clipboard' : `${noun} saved`,
        body: copied
          ? `Paste anywhere to share this ${recording ? 'recording' : 'screenshot'}.`
          : 'Open Snipping Tool to copy the link.',
        actionUrl: '/applications/snipping-tool',
      });

      // Lets an open Snipping Tool page prepend the new row without polling.
      window.dispatchEvent(new CustomEvent('bluu:snip-created', { detail: snip }));
    },
    [],
  );

  const handleCapture = useCallback(
    async (capture: { dataBase64: string; width: number; height: number }) => {
      if (uploadingRef.current) return;
      uploadingRef.current = true;

      const toastId = toast.loading('Uploading snip…');
      try {
        const idToken = await auth.currentUser?.getIdToken();
        if (!idToken) throw new Error('Session expired — sign in again.');

        await announce(await uploadSnip(idToken, capture), toastId);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'The snip could not be saved', {
          id: toastId,
        });
      } finally {
        uploadingRef.current = false;
      }
    },
    [announce],
  );

  /**
   * A finished recording, handed over by main as a token rather than bytes.
   *
   * **This one announces itself before it starts, which the still path does
   * not**, and that is the substantive difference between them. A screenshot
   * uploads in a second or two; a ten-minute recording is tens of megabytes
   * and can take a minute on a normal connection — during which the control
   * bar has already vanished, the app window is behind whatever the user went
   * back to, and there is nothing on screen to say anything is happening. An
   * in-app toast does not cover that: the app is not the front window. So the
   * OS notification fires at the *start* of the upload as well as at the end.
   *
   * The two notifications share an id on purpose, so the second replaces the
   * first in the notification centre rather than stacking beside it and
   * leaving "uploading" sitting there after it finished.
   */
  const handleRecorded = useCallback(
    async (recording: {
      token: string;
      durationMs: number;
      width: number;
      height: number;
      bytes: number;
      hasPoster: boolean;
    }) => {
      if (uploadingRef.current) {
        // **Left in the queue, not discarded.** This used to throw the file
        // away to avoid two uploads at once, which meant a recording could be
        // lost to nothing worse than bad timing. It now stays on disk as a
        // pending row and the sweep below picks it up as soon as the current
        // upload finishes.
        toast.info('That recording is queued — it will upload once the current one finishes.');
        return;
      }
      uploadingRef.current = true;

      const notificationId = `snip-upload-${recording.token}`;
      window.electronAPI?.notifications?.show?.({
        id: notificationId,
        playSound: false,
        title: 'Video recording uploading',
        body: 'You will get the link on your clipboard when it finishes.',
        actionUrl: '/applications/snipping-tool',
      });

      const toastId = toast.loading('Uploading recording…', {
        description: 'This can take a moment for a long recording.',
      });
      try {
        const idToken = await auth.currentUser?.getIdToken();
        if (!idToken) throw new Error('Session expired — sign in again.');

        await announce(await uploadSnipRecording(idToken, recording), toastId);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'The recording could not be saved';
        toast.error(message, { id: toastId });
        // The failure needs an OS notification for exactly the reason the
        // start did: the user walked away from this window a minute ago, and a
        // toast on a hidden surface is a failure they never learn about.
        window.electronAPI?.notifications?.show?.({
          id: notificationId,
          playSound: false,
          title: 'Recording not uploaded',
          body: message,
          actionUrl: '/applications/snipping-tool',
        });
      } finally {
        uploadingRef.current = false;
      }
    },
    [announce],
  );

  /**
   * Retries anything sitting in main's on-disk queue.
   *
   * The queue survives a quit, a crash and a reboot, so this runs on mount as
   * well as on demand — the commonest way an upload fails is the app being
   * closed while one is in flight, and the user's next launch is exactly when
   * they want it finished.
   *
   * **One at a time, oldest first.** These are hundred-megabyte files; three
   * in parallel would starve each other and make every one of them more
   * likely to time out. `uploadingRef` is shared with the live path so a
   * retry can never race a fresh recording.
   */
  const drainQueue = useCallback(
    async (options: { announce?: boolean } = {}) => {
      const api = window.electronAPI?.snip;
      if (!api?.listPendingRecordings || uploadingRef.current) return;

      let pending: Awaited<ReturnType<NonNullable<typeof api.listPendingRecordings>>> = [];
      try {
        pending = await api.listPendingRecordings();
      } catch {
        return;
      }
      // Oldest first: the one that has been waiting longest is the one most
      // likely to be about to age out of the queue.
      const queue = [...pending]
        .filter(item => item.state !== 'uploading')
        .sort((a, b) => a.createdAt - b.createdAt);
      if (queue.length === 0) return;

      for (const item of queue) {
        if (uploadingRef.current) return;
        if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
        uploadingRef.current = true;
        const toastId = options.announce
          ? toast.loading(`Retrying an unsent recording (${formatSnipDuration(item.durationMs)})…`)
          : undefined;
        try {
          const idToken = await auth.currentUser?.getIdToken();
          if (!idToken) return;
          const snip = await uploadSnipRecording(idToken, item);
          // The automatic pass is genuinely quiet: no clipboard write, no
          // toast, just the OS notification. It used to open a loading toast
          // here and fall through to a full announce, which took the user's
          // clipboard on every app launch and every wifi reconnect — the exact
          // opposite of what the comment below has always claimed.
          await announce(snip, toastId, { interactive: options.announce === true });
        } catch (error) {
          // Quiet on an automatic pass. The page lists the failure with its
          // reason and a Retry, and a toast per queued item at every app
          // launch would be noise about something already visible.
          if (toastId !== undefined) {
            toast.error(error instanceof Error ? error.message : 'That recording did not upload', {
              id: toastId,
            });
          }
          return;
        } finally {
          uploadingRef.current = false;
        }
      }
    },
    [announce],
  );

  // On mount, and whenever the machine comes back online. Not on a timer:
  // a failed upload is already visible on the page with a Retry, and polling
  // a queue that is almost always empty costs a wake-up for nothing.
  useEffect(() => {
    const api = window.electronAPI?.snip;
    if (!api?.listPendingRecordings) return;

    // A beat after mount so a fresh capture, a sign-in or a navigation is not
    // competing with a several-hundred-megabyte upload for the connection.
    const timer = setTimeout(() => { void drainQueue(); }, 4000);
    const onOnline = () => { void drainQueue(); };
    window.addEventListener('online', onOnline);
    // The page asks for this when the user presses Retry on a row.
    const onRetry = () => { void drainQueue({ announce: true }); };
    window.addEventListener('bluu:snip-retry-uploads', onRetry);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('bluu:snip-retry-uploads', onRetry);
    };
  }, [drainQueue]);

  // `handleCapture` is stable (no deps), so this subscribes once and does not
  // re-register on every render. That matters: `removeCapturedListeners` is a
  // `removeAllListeners`, so a churning subscription would race itself.
  useEffect(() => {
    const api = window.electronAPI?.snip;
    if (!api?.onCaptured) return;
    api.onCaptured(handleCapture);
    api.onRecorded?.(handleRecorded);
    // The screen is photographed after the box is drawn, so a capture failure
    // costs the user work they have already done. Saying nothing would look
    // like the tool ignored them — and saying only "try again" is barely
    // better, because the most common cause on macOS is a permission that no
    // amount of retrying will grant.
    api.onFailed?.(payload => {
      // Screen Recording, from either path — the still capture's up-front
      // check or the recorder's stream request. Retrying cannot fix it, which
      // is why this is the one failure that carries an action instead of an
      // invitation to try again.
      //
      // **Both reasons are macOS-only by the time they reach here.** Windows
      // has no per-app Screen Recording permission, so there is no setting to
      // open and nothing to grant; main rewrites a Windows `screen-permission`
      // to `stream-refused` rather than letting this toast offer a button that
      // cannot do anything. The `isMac` guard below is the second belt — an
      // "Open Settings" action that no-ops is worse than no action at all,
      // because the user presses it and concludes the app is broken.
      if (payload?.reason === 'permission' || payload?.reason === 'screen-permission') {
        toast.error('Bluu needs Screen Recording permission to capture.', {
          description: 'Turn it on in System Settings → Privacy & Security → Screen Recording, then try again.',
          action:
            isMac() && window.electronAPI?.permissions?.requestScreenAccess
              ? {
                  label: 'Open Settings',
                  onClick: () => { window.electronAPI?.permissions?.requestScreenAccess?.(); },
                }
              : undefined,
        });
        return;
      }
      // Our own display-media handler refused, or the OS produced no screen
      // source. Neither is a permission the user can go and switch on, so this
      // says what it actually is and offers a retry rather than a dead button.
      if (payload?.reason === 'stream-refused' || payload?.reason === 'no-activation') {
        // Deliberately does not tell the user to change anything. Both of
        // these are our own plumbing failing, not something on their machine,
        // and the previous wording ("restart the app") sent people to do
        // housekeeping that could not have helped.
        toast.error('The screen could not be captured for recording.', {
          description: 'This one is on us, not your settings. Try once more, and report it if it keeps happening.',
        });
        return;
      }
      if (payload?.reason === 'empty' || payload?.reason === 'no-sources') {
        // Realistically a display that changed underneath us — unplugged, or a
        // resolution switch — inside the window between the drag and the shot.
        toast.error('That screen could not be read.', {
          description: 'If you changed displays mid-capture, try again.',
        });
        return;
      }
      // A recording that died says so as a recording. "That region could not
      // be captured" is wrong and confusing for a take the user watched run
      // for two minutes, and each of these has its own cause.
      if (payload?.reason === 'recorder-lost') {
        toast.error('The recording stopped unexpectedly and was not saved.');
        return;
      }
      if (payload?.reason === 'empty-recording') {
        toast.error('That recording came out empty — nothing was saved.', {
          description: 'Try again, and check the region is on a screen that is still connected.',
        });
        return;
      }
      if (payload?.reason === 'encoder') {
        toast.error('This machine could not encode the recording.', {
          description: 'Capture an image instead, or report this — it is not something a retry will fix.',
        });
        return;
      }
      if (payload?.reason === 'storage') {
        toast.error('There was no room to write the recording.', {
          description: 'Free some disk space and try again.',
        });
        return;
      }
      toast.error('That region could not be captured — try again.');
    });
    return () => {
      api.removeCapturedListeners?.();
      api.removeRecordedListeners?.();
    };
  }, [handleCapture, handleRecorded]);

  // ── 2b. Remember the Video audio toggles ───────────────────────────
  //
  // Set on the selection surface, which has no session; relayed here through
  // main, because this is the only window that can write to Firestore. The
  // write is fire-and-forget: the toggles have already taken effect for the
  // capture the user is about to make, and this is only what makes the choice
  // survive to the next one.
  useEffect(() => {
    const api = window.electronAPI?.snip;
    if (!api?.onAudioPrefs) return;
    api.onAudioPrefs(async prefs => {
      try {
        const idToken = await auth.currentUser?.getIdToken();
        if (!idToken) return;
        await fetch('/api/snips/settings', {
          method: 'PUT',
          headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(prefs),
        });
      } catch {
        // Losing the preference costs one toggle next time. It must never
        // surface as an error over the capture the user is in the middle of.
      }
    });
    return () => api.removeAudioPrefsListeners?.();
  }, []);

  // ── 3. The tray's "My Snips" ───────────────────────────────────────
  useEffect(() => {
    const api = window.electronAPI?.snip;
    if (!api?.onNavigate) return;
    api.onNavigate(href => {
      // Relative, same-app paths only. The channel comes from our own main
      // process, but a navigation target is exactly the kind of value that
      // should not be taken on trust.
      if (typeof href === 'string' && href.startsWith('/') && !href.startsWith('//')) {
        router.push(href);
      }
    });
    return () => api.removeNavigateListeners?.();
  }, [router]);

  return null;
}
