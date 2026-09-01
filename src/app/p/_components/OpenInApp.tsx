'use client';

import { useCallback, useEffect, useState } from 'react';
import { ArrowUpRight, Loader2 } from 'lucide-react';
import { signInWithPopup } from 'firebase/auth';
import { auth, googleProvider } from '@/firebase-config';
import { getDeviceId, getDeviceLabel } from '@/lib/deviceId';
import { promptDeepLink } from '@/lib/promptShareUrl';

/**
 * "Open in Bluu Backend" — the hand-off from the public page back into the app.
 *
 * ## The gate
 *
 * The button fires a `bluu://` deep link. For someone with the desktop app that
 * focuses the app and routes them to this prompt; for anyone else the OS has no
 * handler and the click does nothing visible — a dead control, which is the
 * problem this component exists to avoid.
 *
 * So the presentation is gated on whether this browser is **recognised**: the
 * device id in localStorage (`lib/deviceId.ts`) is offered to
 * `POST /api/auth/device`, which answers a bare boolean by looking the id up in
 * the server-side `device-sessions` index. Recognised → the button is the
 * page's primary action. Unrecognised → it is quiet, sits beside a Download
 * link, and says plainly what it needs.
 *
 * **It is never hidden outright.** A staff member reading this on a browser they
 * have not linked yet is indistinguishable from an external recipient, and
 * hiding the control would leave them with no route into the app and no way to
 * fix it. The quiet variant still works if they do have the app.
 *
 * ## Linking a browser
 *
 * "I work here" runs an ordinary Google sign-in and registers this browser as a
 * web device against the user's account. That is the whole mechanism — the same
 * allowlist as every other login decides whether it is honoured, and a web
 * session deliberately does not disturb the user's desktop session.
 *
 * This is the first working piece of web access: once a browser is linked, it
 * holds a real, server-recognised session for a real user.
 */
export function OpenInApp({ promptId }: { promptId: string }) {
  /** `null` while the answer is still in flight — the button must not flicker. */
  const [known, setKnown] = useState<boolean | null>(null);
  const [linking, setLinking] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);

  const check = useCallback(async () => {
    const deviceId = getDeviceId();
    if (!deviceId) {
      setKnown(false);
      return;
    }
    try {
      const res = await fetch('/api/auth/device', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId }),
      });
      const data = await res.json().catch(() => ({ known: false }));
      setKnown(data.known === true);
    } catch {
      // Fail closed: a network error is not evidence the visitor is staff.
      setKnown(false);
    }
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  const link = async () => {
    setLinking(true);
    setLinkError(null);
    try {
      const result = await signInWithPopup(auth, googleProvider);
      const idToken = await result.user.getIdToken();

      const res = await fetch('/api/auth/session-token', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${idToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ deviceId: getDeviceId(), deviceLabel: getDeviceLabel() }),
      });

      if (!res.ok) {
        // The half-established Firebase session must be torn down — the same
        // rule the Login screen follows. The refusal is deliberately generic
        // server-side and stays generic here.
        await auth.signOut();
        setLinkError('That account is not in the system. Ask your team leader to add you.');
        return;
      }

      const data = await res.json();
      if (typeof data.sessionToken === 'string') {
        try {
          localStorage.setItem('sessionToken', data.sessionToken);
        } catch {
          // Storage blocked. The device is registered server-side regardless;
          // only the local half of session enforcement is unavailable.
        }
      }
      setKnown(true);
    } catch {
      setLinkError('Sign-in did not complete. Please try again.');
    } finally {
      setLinking(false);
    }
  };

  const href = promptDeepLink(promptId);

  if (known === null) {
    return <div className="h-[3.25rem]" aria-hidden />;
  }

  if (known) {
    return (
      <section aria-label="Open in the desktop app" className="flex flex-col gap-2">
        <a
          href={href}
          className="inline-flex w-fit items-center gap-2 rounded-md bg-[#3b82f6] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#2563eb] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3b82f6] focus-visible:ring-offset-2 focus-visible:ring-offset-[#09090b]"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo/bluu_uu.svg" alt="" aria-hidden className="size-4" />
          Open in Bluu Backend
          <ArrowUpRight className="size-4" aria-hidden />
        </a>
        <p className="text-xs text-zinc-500">
          Opens the desktop app and takes you to this prompt.
        </p>
      </section>
    );
  }

  return (
    <section aria-label="Open in the desktop app" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <a
          href={href}
          className="inline-flex items-center gap-2 rounded-md border border-white/[0.09] px-3.5 py-2 text-sm font-medium text-zinc-200 transition-colors hover:border-white/[0.16] hover:bg-white/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3b82f6]"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo/bluu_uu.svg" alt="" aria-hidden className="size-4" />
          Open in Bluu Backend
        </a>
        <a
          href="/download"
          className="rounded-sm text-xs text-zinc-400 underline underline-offset-2 transition-colors hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3b82f6]"
        >
          Get the app
        </a>
      </div>

      <p className="text-xs text-zinc-500">
        Requires the Bluu desktop app.{' '}
        <button
          type="button"
          onClick={link}
          disabled={linking}
          className="inline-flex items-center gap-1 rounded-sm text-zinc-300 underline underline-offset-2 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3b82f6] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {linking && <Loader2 className="size-3 animate-spin" aria-hidden />}
          {linking ? 'Signing in…' : 'I work here — link this browser'}
        </button>
      </p>

      {linkError && (
        <p role="alert" className="text-xs text-[#f87171]">
          {linkError}
        </p>
      )}
    </section>
  );
}
