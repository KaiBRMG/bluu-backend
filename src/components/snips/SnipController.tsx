'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { auth } from '@/firebase-config';
import { useUserData } from '@/hooks/useUserData';
import { copyText } from '@/lib/copyText';
import { SNIPPING_TOOL_PAGE_ID, resolveSnipSettings } from '@/lib/snips';
import { uploadSnip } from '@/lib/snipUpload';

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
export default function SnipController() {
  const { userData } = useUserData();
  const router = useRouter();

  // Rule 9i: never key an effect on the snapshot object. `users/{uid}` is
  // rewritten by presence every ten minutes, which would re-arm the shortcut
  // (and re-register it with the OS) on a timer for no reason. Each of these is
  // a primitive, so the effects below fire only when the value actually changes.
  const enabled = !!userData?.permittedPageIds?.includes(SNIPPING_TOOL_PAGE_ID);
  const settings = resolveSnipSettings(userData?.snipSettings);
  const { trayIconEnabled, shortcutEnabled, shortcut } = settings;

  // ── 1. Arm / disarm the shell ──────────────────────────────────────
  useEffect(() => {
    const api = window.electronAPI?.snip;
    // Feature-detected: a browser has no shell, and an installed build older
    // than this feature has no `snip` bridge (rule 9c). Both are no-ops.
    if (!api?.configure) return;

    api
      .configure({ enabled, trayIconEnabled, shortcutEnabled, shortcut })
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
  }, [enabled, trayIconEnabled, shortcutEnabled, shortcut]);

  // ── 2. Upload a capture ────────────────────────────────────────────

  // One upload at a time. Main already refuses to open a second set of overlays
  // while one is in flight, but a slow upload and a fast second capture are not
  // the same race — this one is about two toasts fighting over the clipboard.
  const uploadingRef = useRef(false);

  const handleCapture = useCallback(
    async (capture: { dataBase64: string; width: number; height: number }) => {
      if (uploadingRef.current) return;
      uploadingRef.current = true;

      const toastId = toast.loading('Uploading snip…');
      try {
        const idToken = await auth.currentUser?.getIdToken();
        if (!idToken) throw new Error('Session expired — sign in again.');

        const snip = await uploadSnip(idToken, capture);

        // The link goes on the clipboard the moment the upload lands — that is
        // the deliverable, not the snip itself. `copyText` prefers the main
        // process because `navigator.clipboard` needs the document focused and
        // this window is usually behind whatever the user was looking at.
        const copied = await copyText(snip.shareUrl);

        toast.success(copied ? 'Link copied to clipboard' : 'Snip saved', {
          id: toastId,
          description: copied ? snip.shareUrl : 'Open Snipping Tool to copy the link.',
        });

        // The OS notification is the one that will actually be seen: the app is
        // very likely not the front window, so an in-app toast lands on a
        // surface nobody is looking at. Silent — it confirms, it does not
        // interrupt. Clicking it opens the library.
        //
        // It states the *outcome* rather than the event ("Link copied", not
        // "Snip uploaded"), because the clipboard is the only thing the user
        // needs to act on, and it never claims a copy that did not happen.
        window.electronAPI?.notifications?.show?.({
          id: `snip-${snip.id}`,
          playSound: false,
          title: copied ? 'Link copied to clipboard' : 'Snip saved',
          body: copied
            ? 'Paste anywhere to share this screenshot.'
            : 'Open Snipping Tool to copy the link.',
          actionUrl: '/applications/snipping-tool',
        });

        // Lets an open Snipping Tool page prepend the new row without polling.
        window.dispatchEvent(new CustomEvent('bluu:snip-created', { detail: snip }));
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'The snip could not be saved', {
          id: toastId,
        });
      } finally {
        uploadingRef.current = false;
      }
    },
    [],
  );

  // `handleCapture` is stable (no deps), so this subscribes once and does not
  // re-register on every render. That matters: `removeCapturedListeners` is a
  // `removeAllListeners`, so a churning subscription would race itself.
  useEffect(() => {
    const api = window.electronAPI?.snip;
    if (!api?.onCaptured) return;
    api.onCaptured(handleCapture);
    // The screen is photographed after the box is drawn, so a capture failure
    // costs the user work they have already done. Saying nothing would look
    // like the tool ignored them — and saying only "try again" is barely
    // better, because the most common cause on macOS is a permission that no
    // amount of retrying will grant.
    api.onFailed?.(payload => {
      if (payload?.reason === 'permission') {
        toast.error('Bluu needs Screen Recording permission to capture.', {
          description: 'Turn it on in System Settings → Privacy & Security → Screen Recording, then try again.',
          action: window.electronAPI?.permissions?.requestScreenAccess
            ? {
                label: 'Open Settings',
                onClick: () => { window.electronAPI?.permissions?.requestScreenAccess?.(); },
              }
            : undefined,
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
      toast.error('That region could not be captured — try again.');
    });
    return () => api.removeCapturedListeners?.();
  }, [handleCapture]);

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
